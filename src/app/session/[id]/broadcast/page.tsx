"use client";

import { useEffect, useState, useCallback, useRef, use } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useLocalParticipant,
  useRoomContext,
  useRemoteParticipants,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { Track, LocalAudioTrack, RoomEvent } from "livekit-client";
import SessionQRCode from "@/components/SessionQRCode";

interface TranscriptEntry {
  id: string;
  text: string;
  language: string;
  final: boolean;
  timestamp: number;
}

interface TranslationInfo {
  language: string;
  translatorIdentity: string;
  status: string;
  subscriberCount: number;
  inputTokens: number;
  outputTokens: number;
}

const INPUT_PRICE_PER_TOKEN = 0.0000035; // $3.50 / 1M
const OUTPUT_PRICE_PER_TOKEN = 0.000021;  // $21.00 / 1M

const FLAGS: Record<string, string> = {
  en: "🇺🇸", es: "🇪🇸", fr: "🇫🇷", de: "🇩🇪", it: "🇮🇹",
  pt: "🇧🇷", ja: "🇯🇵", ko: "🇰🇷", "zh-CN": "🇨🇳", "zh-TW": "🇹🇼", ar: "🇸🇦",
  hi: "🇮🇳", ru: "🇷🇺", tr: "🇹🇷", nl: "🇳🇱", pl: "🇵🇱", sv: "🇸🇪",
};

const LANG_NAMES: Record<string, string> = {
  en: "English", es: "Spanish", fr: "French", de: "German", it: "Italian",
  pt: "Portuguese", ja: "Japanese", ko: "Korean", "zh-CN": "Chinese (Simplified)", "zh-TW": "Chinese (Traditional)", ar: "Arabic",
  hi: "Hindi", ru: "Russian", tr: "Turkish", nl: "Dutch", pl: "Polish", sv: "Swedish",
};

function BroadcastControls({ sessionId }: { sessionId: string }) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const [translations, setTranslations] = useState<TranslationInfo[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [monitoringIdentity, setMonitoringIdentity] = useState<string | null>(null);
  const [transcriptArchive, setTranscriptArchive] = useState<TranscriptEntry[]>([]);
  const [sessionName, setSessionName] = useState(sessionId);
  const [isArchived, setIsArchived] = useState(false);
  const remoteParticipants = useRemoteParticipants();
  const captureStreamRef = useRef<MediaStream | null>(null);
  const publishedTrackRef = useRef<LocalAudioTrack | null>(null);
  const transcriptArchiveRef = useRef<TranscriptEntry[]>([]);

  // Count only real attendees, not translator bots

  useEffect(() => {
    try {
      const sessions = JSON.parse(localStorage.getItem("liveTranslateSessions") || "[]");
      const current = sessions.find((s: { sessionId: string }) => s.sessionId === sessionId);
      if (current?.name) window.setTimeout(() => setSessionName(current.name), 0);
      localStorage.setItem("liveTranslateLastBroadcastSession", sessionId);
    } catch {}

    fetch(`/api/sessions/${sessionId}/transcripts`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (Array.isArray(data?.entries)) setTranscriptArchive(data.entries);
      })
      .catch(() => {});

    fetch(`/api/sessions/${sessionId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.status === "archived") setIsArchived(true);
      })
      .catch(() => {});
  }, [sessionId]);

  useEffect(() => {
    transcriptArchiveRef.current = transcriptArchive;
  }, [transcriptArchive]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isCapturing && translations.length === 0 && transcriptArchiveRef.current.length === 0) {
        return;
      }
      event.preventDefault();
      event.returnValue = "Broadcast is still running. Leave anyway?";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isCapturing, translations.length]);

  useEffect(() => {
    if (!room) return;
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    const publishHistory = async () => {
      const history = transcriptArchiveRef.current.slice(-10);
      if (history.length === 0) return;
      await room.localParticipant.publishData(
        encoder.encode(JSON.stringify({ type: "transcription-history", entries: history })),
        { reliable: true, topic: "transcription-history" }
      );
    };

    const handleData = (payload: Uint8Array, _participant: unknown, _kind: unknown, topic?: string) => {
      if (topic !== "transcription") return;
      try {
        const data = JSON.parse(decoder.decode(payload));
        if (data.type !== "transcription") return;
        const entry: TranscriptEntry = {
          id: data.segmentId,
          text: data.text,
          language: data.language,
          final: data.final,
          timestamp: data.timestamp || Date.now(),
        };
        fetch(`/api/sessions/${sessionId}/transcripts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(entry),
        }).catch(() => {});
        setTranscriptArchive((prev) => {
          const existing = prev.findIndex((item) => item.id === entry.id);
          const next = existing >= 0 ? [...prev] : [...prev, entry];
          if (existing >= 0) {
            next[existing] = { ...next[existing], text: next[existing].text + entry.text, final: entry.final };
          }
          return next.slice(-500);
        });
      } catch {}
    };

    room.on(RoomEvent.DataReceived, handleData);
    room.on(RoomEvent.ParticipantConnected, publishHistory);
    const interval = window.setInterval(publishHistory, 10000);
    return () => {
      room.off(RoomEvent.DataReceived, handleData);
      room.off(RoomEvent.ParticipantConnected, publishHistory);
      window.clearInterval(interval);
    };
  }, [room, sessionId]);

  useEffect(() => {
    if (!room) return;
    for (const [, participant] of room.remoteParticipants) {
      for (const [, pub] of participant.trackPublications) {
        if (pub.kind === Track.Kind.Audio) {
          pub.setSubscribed(!!monitoringIdentity && participant.identity === monitoringIdentity);
        }
      }
    }
  }, [room, monitoringIdentity, remoteParticipants]);

  useEffect(() => {
    try {
      const sessions = JSON.parse(localStorage.getItem("liveTranslateSessions") || "[]");
      const totalTokens = translations.reduce((sum, item) => sum + item.inputTokens + item.outputTokens, 0);
      const next = sessions.map((session: { sessionId: string; languageCount?: number; tokenCount?: number }) =>
        session.sessionId === sessionId
          ? { ...session, languageCount: translations.length, tokenCount: totalTokens }
          : session
      );
      localStorage.setItem("liveTranslateSessions", JSON.stringify(next));
    } catch {}
  }, [sessionId, translations]);

  const downloadTranscript = useCallback(() => {
    const lines = [
      `## Session: ${sessionName} (${new Date().toLocaleString()})`,
      "",
      ...transcriptArchive.map((entry) => {
        const elapsed = Math.max(0, Math.floor((entry.timestamp - (transcriptArchive[0]?.timestamp || entry.timestamp)) / 1000));
        const stamp = new Date(elapsed * 1000).toISOString().slice(11, 19);
        return `[${stamp}] (${entry.language}) ${entry.text}`;
      }),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${sessionName.replace(/[^a-z0-9-_]+/gi, "-") || sessionId}-transcript.md`;
    link.click();
    URL.revokeObjectURL(url);
  }, [sessionId, sessionName, transcriptArchive]);

  const listenerCount = remoteParticipants.filter(
    (p) => !p.identity.startsWith("translator-")
  ).length;

  const joinUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/session/${sessionId}/watch`
      : "";

  const fetchTranslations = useCallback(async () => {
    try {
      const res = await fetch(`/api/translate/status?sessionId=${sessionId}`);
      const data = await res.json();
      setTranslations(data.translations || []);
    } catch (err) {
      console.error("Failed to fetch translations:", err);
    }
  }, [sessionId]);

  useEffect(() => {
    window.setTimeout(fetchTranslations, 0);
    const interval = setInterval(fetchTranslations, 3000);
    return () => clearInterval(interval);
  }, [fetchTranslations]);

  const stopCapture = useCallback(() => {
    if (publishedTrackRef.current) {
      localParticipant.unpublishTrack(publishedTrackRef.current);
      publishedTrackRef.current.stop();
      publishedTrackRef.current = null;
    }
    if (captureStreamRef.current) {
      captureStreamRef.current.getTracks().forEach((t) => t.stop());
      captureStreamRef.current = null;
    }
    setIsCapturing(false);
  }, [localParticipant]);

  const startCapture = useCallback(async () => {
    try {
      setCapturing(true);
      const stream = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: true,
      });
      captureStreamRef.current = stream;

      // Extract audio track from the display media stream
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        alert("No audio track found. Make sure to enable 'Share tab audio' when selecting a tab.");
        stream.getTracks().forEach((t) => t.stop());
        setCapturing(false);
        return;
      }

      const audioTrack = audioTracks[0];

      // Create a LiveKit LocalAudioTrack from the MediaStreamTrack
      const lkTrack = new LocalAudioTrack(audioTrack);
      publishedTrackRef.current = lkTrack;

      await localParticipant.publishTrack(lkTrack);
      setIsCapturing(true);
      setCapturing(false);

      // Stop video tracks (we only need audio)
      stream.getVideoTracks().forEach((t) => t.stop());

      // Clean up when user stops screen share via browser UI
      audioTrack.addEventListener("ended", () => {
        stopCapture();
      });
    } catch (err) {
      console.error("Failed to capture screen audio:", err);
      setCapturing(false);
    }
  }, [localParticipant, stopCapture]);



  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (publishedTrackRef.current) {
        publishedTrackRef.current.stop();
      }
      if (captureStreamRef.current) {
        captureStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  return (
    <div className="container enter">
      {/* Header */}
      <div style={{ marginBottom: 48 }}>
        <h1 className="display display-lg" style={{ marginBottom: 8 }}>
          Broadcasting
        </h1>
        <p style={{ marginBottom: 4, fontWeight: 500 }}>{sessionName}</p>
        <p className="mono">{sessionId}</p>
      </div>

      {/* Audio capture status */}
      <div style={{ marginBottom: 40 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 20,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div className={`waveform ${isCapturing ? "active" : "idle"}`}>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="waveform-bar" />
              ))}
            </div>
            <span
              className="status"
              style={{ color: isCapturing ? "var(--success)" : "var(--fg-ghost)" }}
            >
              <span className={`status-dot ${isCapturing ? "pulse" : ""}`} />
              {isCapturing ? "Capturing" : "Idle"}
            </span>
          </div>

          <span className="mono">
            {listenerCount} listener{listenerCount !== 1 ? "s" : ""}
          </span>
        </div>

        <button
          onClick={isArchived ? undefined : (isCapturing ? stopCapture : startCapture)}
          disabled={capturing || isArchived}
          style={{
            width: "100%",
            padding: "14px 32px",
            fontFamily: "var(--font-body)",
            fontSize: "14px",
            fontWeight: 500,
            border: isCapturing ? "1px solid var(--error)" : "none",
            borderRadius: 0,
            background: isCapturing ? "transparent" : isArchived ? "var(--bg-elevated)" : "var(--fg)",
            color: isCapturing ? "var(--error)" : isArchived ? "var(--fg-tertiary)" : "var(--bg)",
            cursor: capturing || isArchived ? "not-allowed" : "pointer",
            opacity: capturing ? 0.6 : 1,
          }}
        >
          {isArchived
            ? "Session archived"
            : capturing
            ? "Starting..."
            : isCapturing
            ? "Stop capturing"
            : "Capture tab / window audio"}
        </button>

        <p
          style={{
            marginTop: 12,
            fontSize: "12px",
            color: "var(--fg-ghost)",
            textAlign: "center",
          }}
        >
          Select a browser tab or window with audio playback.
          Make sure &quot;Share tab audio&quot; is checked.
        </p>
      </div>

      <hr className="rule" />

      {/* QR code */}
      <div
        style={{
          padding: "32px 0",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
        }}
      >
        <span className="label">Share with attendees</span>
        <SessionQRCode url={joinUrl} size={140} />
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <p className="mono" style={{ wordBreak: "break-all", textAlign: "center", margin: 0 }}>
            {joinUrl}
          </p>
          <button
            onClick={() => navigator.clipboard.writeText(joinUrl)}
            style={{
              flexShrink: 0,
              padding: "4px 10px",
              fontSize: 12,
              fontFamily: "var(--font-body)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              background: "var(--bg-elevated)",
              color: "var(--fg-secondary)",
              cursor: "pointer",
            }}
            title="Copy link"
          >
            Copy
          </button>
        </div>
      </div>

      <hr className="rule" />

      {/* Active translations */}
      <div style={{ padding: "28px 0" }}>
        <span className="label" style={{ marginBottom: 16, display: "block" }}>
          Translations · {translations.length}
        </span>

        {translations.length === 0 ? (
          <p className="body-sm italic">
            None yet — attendees can request them
          </p>
        ) : (
          translations.map((t) => (
            <div key={t.language} className="lang-row">
              <div className="lang-row-left">
                <span className="lang-flag">{FLAGS[t.language] || "🌐"}</span>
                <span className="lang-name">
                  {LANG_NAMES[t.language] || t.language.toUpperCase()}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <button
                  onClick={() => setMonitoringIdentity((current) => current === t.translatorIdentity ? null : t.translatorIdentity)}
                  title={`Monitor ${LANG_NAMES[t.language] || t.language} audio`}
                  style={{ border: "1px solid var(--border)", background: monitoringIdentity === t.translatorIdentity ? "var(--success-soft)" : "transparent", cursor: "pointer", padding: "4px 8px" }}
                >
                  👂
                </button>
                <span className="lang-meta">
                  {t.subscriberCount} listener{t.subscriberCount !== 1 ? "s" : ""}
                </span>
                <span className={`status status--${t.status === "active" ? "active" : "waiting"}`}>
                  <span className="status-dot pulse" />
                  {t.status}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Token Usage */}
      {translations.length > 0 && (() => {
      const totalInput = translations.reduce((s, t) => s + t.inputTokens, 0);
      const totalOutput = translations.reduce((s, t) => s + t.outputTokens, 0);
      const totalTokens = totalInput + totalOutput;
      const cost = totalInput * INPUT_PRICE_PER_TOKEN + totalOutput * OUTPUT_PRICE_PER_TOKEN;
      return (
        <div style={{ padding: "0 0 28px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
            <span className="label">Token Usage</span>
            <span className="mono" style={{ color: "var(--success)", fontWeight: 600 }}>
              {totalTokens.toLocaleString()} tokens · ~${cost.toFixed(4)}
            </span>
          </div>
        </div>
      );
      })()}

      <hr className="rule" />

      <div style={{ padding: "28px 0" }}>
        <button className="btn btn-outline" onClick={downloadTranscript} disabled={transcriptArchive.length === 0} style={{ width: "100%", opacity: transcriptArchive.length === 0 ? 0.5 : 1 }}>
          Download complete transcript ({transcriptArchive.length})
        </button>
      </div>

      <hr className="rule" />

      {/* End */}
      <div style={{ paddingTop: 28 }}>
      <button
        className="btn-danger"
        onClick={isArchived ? undefined : (async () => {
          stopCapture();
          sessionStorage.setItem("liveTranslateIntentionalDisconnect", "1");
          fetch(`/api/sessions/${sessionId}/end`, { method: "POST" }).catch(() => {});
          room.disconnect();
          window.location.href = "/";
        })}
        disabled={isArchived}
        style={{ width: "100%", opacity: isArchived ? 0.4 : 1, cursor: isArchived ? "not-allowed" : "pointer" }}
      >
        End broadcast
      </button>
      </div>
    </div>
  );
}

export default function BroadcastPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: sessionId } = use(params);
  const [token, setToken] = useState("");
  const [livekitUrl, setLivekitUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchToken() {
      try {
        const identity = `organizer-host`;
        const res = await fetch(
          `/api/token?room=${sessionId}&identity=${identity}&role=organizer`
        );
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setToken(data.token);
        setLivekitUrl(data.serverUrl);
      } catch (err) {
        setError((err as Error).message);
      }
    }
    fetchToken();
  }, [sessionId]);

  if (error) {
    return (
      <div className="page">
        <div className="container" style={{ textAlign: "center" }}>
          <p className="display display-md" style={{ marginBottom: 16 }}>
            Something went wrong
          </p>
          <p className="body-sm" style={{ marginBottom: 32 }}>{error}</p>
          <button className="btn btn-outline" onClick={() => (window.location.href = "/")}>
            Go home
          </button>
        </div>
      </div>
    );
  }

  if (!token || !livekitUrl) {
    return (
      <div className="page">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <div className="spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="page page-top">
      <LiveKitRoom
        video={false}
        audio={false}
        token={token}
        serverUrl={livekitUrl}
        connectOptions={{ autoSubscribe: false }}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          width: "100%",
        }}
        onDisconnected={() => {
          if (sessionStorage.getItem("liveTranslateIntentionalDisconnect") === "1") {
            sessionStorage.removeItem("liveTranslateIntentionalDisconnect");
            return;
          }
          setError("Reconnecting to LiveKit room…");
          window.setTimeout(() => window.location.reload(), 1500);
        }}
      >
        <RoomAudioRenderer />
        <BroadcastControls sessionId={sessionId} />
      </LiveKitRoom>
    </div>
  );
}
