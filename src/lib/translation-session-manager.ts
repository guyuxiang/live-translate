/**
 * TranslationSessionManager: Singleton that enforces "max 1 Gemini Live API
 * session per language per room" constraint.
 *
 * Usage:
 *   const manager = TranslationSessionManager.getInstance();
 *   const bridge = await manager.getOrCreate(sessionId, targetLanguage, organizerIdentity);
 */

import { TranslationBridge, BridgeStatus } from "./translation-bridge";
import { getSQLiteStore } from "./sqlite-store";

export interface TranslationInfo {
  language: string;
  translatorIdentity: string;
  status: BridgeStatus;
  subscriberCount: number;
  inputTokens: number;
  outputTokens: number;
}

export interface SessionInfo {
  sessionId: string;
  organizerIdentity: string;
  name: string;
  createdAt: Date;
  languageCount?: number;
  tokenCount?: number;
  inputTokenCount?: number;
  outputTokenCount?: number;
  costUsd?: number;
  status?: "active" | "ended" | "archived";
  durationSeconds?: number;
  listenerPeakCount?: number;
  lastActivityAt?: Date | null;
}

const INPUT_PRICE_PER_TOKEN = 3.5 / 1_000_000;
const OUTPUT_PRICE_PER_TOKEN = 21 / 1_000_000;

class TranslationSessionManager {
  private static instance: TranslationSessionManager;

  // Map<sessionId, Map<languageCode, TranslationBridge>>
  private translations: Map<string, Map<string, TranslationBridge>> = new Map();

  // Map<sessionId, SessionInfo>
  private sessions: Map<string, SessionInfo> = new Map();

  private constructor() {}

  private get store() {
    return getSQLiteStore();
  }

  static getInstance(): TranslationSessionManager {
    if (!TranslationSessionManager.instance) {
      TranslationSessionManager.instance = new TranslationSessionManager();
    }
    return TranslationSessionManager.instance;
  }

  // Session management
  createSession(sessionId: string, organizerIdentity: string, name?: string): SessionInfo {
    const createdAt = new Date();
    const info: SessionInfo = {
      sessionId,
      organizerIdentity,
      name: name?.trim() || `Session ${createdAt.toLocaleString()}`,
      createdAt,
      languageCount: 0,
      tokenCount: 0,
      inputTokenCount: 0,
      outputTokenCount: 0,
      costUsd: 0,
      status: "active",
      durationSeconds: 0,
      listenerPeakCount: 0,
      lastActivityAt: createdAt,
    };
    this.sessions.set(sessionId, info);
    this.store.saveSession(info);
    console.log(`[SessionManager] Created session ${sessionId} for organizer ${organizerIdentity}`);
    return info;
  }

  getSession(sessionId: string): SessionInfo | undefined {
    const cached = this.sessions.get(sessionId);
    if (cached) return cached;

    const persisted = this.store.getSession(sessionId);
    if (!persisted) return undefined;

    const info: SessionInfo = {
      sessionId: persisted.sessionId,
      organizerIdentity: persisted.organizerIdentity,
      name: persisted.name,
      createdAt: persisted.createdAt,
      languageCount: persisted.languageCount,
      tokenCount: persisted.tokenCount,
      inputTokenCount: persisted.inputTokenCount,
      outputTokenCount: persisted.outputTokenCount,
      costUsd: persisted.costUsd,
      status: persisted.status,
      durationSeconds: persisted.durationSeconds,
      listenerPeakCount: persisted.listenerPeakCount,
      lastActivityAt: persisted.lastActivityAt,
    };
    this.sessions.set(sessionId, info);
    return info;
  }

  invalidateSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  // Translation management
  async getOrCreate(
    sessionId: string,
    targetLanguage: string,
    organizerIdentity: string
  ): Promise<TranslationBridge> {
    // Check if we already have a bridge for this language
    let languageMap = this.translations.get(sessionId);
    if (languageMap) {
      const existingBridge = languageMap.get(targetLanguage);
      if (existingBridge && existingBridge.status === "active") {
        console.log(
          `[SessionManager] Reusing existing bridge for ${targetLanguage} in session ${sessionId}`
        );
        existingBridge.subscriberCount++;
        return existingBridge;
      }
      // If bridge exists but is in error/closed state, clean it up
      if (existingBridge && (existingBridge.status === "error" || existingBridge.status === "closed")) {
        console.log(
          `[SessionManager] Cleaning up stale bridge for ${targetLanguage}`
        );
        await existingBridge.stop();
        languageMap.delete(targetLanguage);
      }
    }

    // Create a new bridge
    console.log(
      `[SessionManager] Creating new bridge for ${targetLanguage} in session ${sessionId}`
    );

    const config = {
      geminiApiKey: process.env.GEMINI_API_KEY!,
      livekitUrl: process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LIVEKIT_URL || "ws://localhost:7880",
      livekitApiKey: process.env.LIVEKIT_API_KEY!,
      livekitApiSecret: process.env.LIVEKIT_API_SECRET!,
    };

    const bridge = new TranslationBridge(
      sessionId,
      targetLanguage,
      organizerIdentity,
      config
    );

    // Store the bridge before starting (to prevent race conditions)
    if (!languageMap) {
      languageMap = new Map();
      this.translations.set(sessionId, languageMap);
    }
    languageMap.set(targetLanguage, bridge);

    try {
      await bridge.start();
      bridge.subscriberCount = 1;
      return bridge;
    } catch (error) {
      // Clean up on failure
      languageMap.delete(targetLanguage);
      throw error;
    }
  }

  getActiveTranslations(sessionId: string): TranslationInfo[] {
    const languageMap = this.translations.get(sessionId);
    if (!languageMap) return [];

    const result: TranslationInfo[] = [];
    for (const [language, bridge] of languageMap) {
      result.push({
        language,
        translatorIdentity: bridge.identity,
        status: bridge.status,
        subscriberCount: bridge.subscriberCount,
        inputTokens: bridge.inputTokens,
        outputTokens: bridge.outputTokens,
      });
    }
    const totalInputTokens = result.reduce((sum, item) => sum + item.inputTokens, 0);
    const totalOutputTokens = result.reduce((sum, item) => sum + item.outputTokens, 0);
    const totalTokens = totalInputTokens + totalOutputTokens;
    const costUsd = result.reduce(
      (sum, item) => sum + item.inputTokens * INPUT_PRICE_PER_TOKEN + item.outputTokens * OUTPUT_PRICE_PER_TOKEN,
      0
    );
    const listenerCount = result.reduce((sum, item) => sum + item.subscriberCount, 0);
    this.store.updateSessionStats(sessionId, {
      languageCount: result.length,
      tokenCount: totalTokens,
      inputTokenCount: totalInputTokens,
      outputTokenCount: totalOutputTokens,
      costUsd,
      listenerCount,
    });
    return result;
  }

  /**
   * Decrement subscriber count for a language. If the last subscriber
   * leaves, stop the bridge and tear down the Gemini session.
   */
  async unsubscribe(
    sessionId: string,
    targetLanguage: string
  ): Promise<void> {
    const languageMap = this.translations.get(sessionId);
    if (!languageMap) return;

    const bridge = languageMap.get(targetLanguage);
    if (!bridge) return;

    bridge.subscriberCount = Math.max(0, bridge.subscriberCount - 1);
    console.log(
      `[SessionManager] Unsubscribed from ${targetLanguage} in session ${sessionId} (${bridge.subscriberCount} remaining)`
    );

    if (bridge.subscriberCount === 0) {
      console.log(
        `[SessionManager] No more subscribers for ${targetLanguage}, tearing down bridge`
      );
      await bridge.stop();
      languageMap.delete(targetLanguage);

      // Clean up the session map if no bridges remain
      if (languageMap.size === 0) {
        this.translations.delete(sessionId);
      }
    }
  }

  async removeTranslation(
    sessionId: string,
    targetLanguage: string
  ): Promise<void> {
    const languageMap = this.translations.get(sessionId);
    if (!languageMap) return;

    const bridge = languageMap.get(targetLanguage);
    if (bridge) {
      await bridge.stop();
      languageMap.delete(targetLanguage);
      console.log(
        `[SessionManager] Removed bridge for ${targetLanguage} in session ${sessionId}`
      );
    }
  }

  async removeAllTranslations(sessionId: string): Promise<void> {
    const languageMap = this.translations.get(sessionId);
    if (!languageMap) return;

    for (const [, bridge] of languageMap) {
      await bridge.stop();
    }
    languageMap.clear();
    this.translations.delete(sessionId);
    this.sessions.delete(sessionId);
    this.store.endSession(sessionId);
    console.log(
      `[SessionManager] Removed all bridges and session for ${sessionId}`
    );
  }

  getAllSessions(): SessionInfo[] {
    const persisted = this.store.getAllSessions();
    return persisted.map((session) => {
      const info: SessionInfo = {
        sessionId: session.sessionId,
        organizerIdentity: session.organizerIdentity,
        name: session.name,
        createdAt: session.createdAt,
        languageCount: session.languageCount,
        tokenCount: session.tokenCount,
        inputTokenCount: session.inputTokenCount,
        outputTokenCount: session.outputTokenCount,
        costUsd: session.costUsd,
        status: session.status,
        durationSeconds: session.durationSeconds,
        listenerPeakCount: session.listenerPeakCount,
        lastActivityAt: session.lastActivityAt,
      };
      this.sessions.set(session.sessionId, info);
      return info;
    });
  }
}

export default TranslationSessionManager;
