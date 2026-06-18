"use client";

import { useEffect, useState, useCallback, useRef, use } from "react";
import {
  LiveKitRoom,
  useLocalParticipant,
  useRoomContext,
  useRemoteParticipants,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { Track, LocalAudioTrack } from "livekit-client";
import SessionQRCode from "@/components/SessionQRCode";

interface TranslationInfo {
  language: string;
  translatorIdentity: string;
  status: string;
  subscriberCount: number;
}

const FLAGS: Record<string, string> = {
  en: "🇺🇸", es: "🇪🇸", fr: "🇫🇷", de: "🇩🇪", it: "🇮🇹",
  pt: "🇧🇷", ja: "🇯🇵", ko: "🇰🇷", zh: "🇨🇳", ar: "🇸🇦",
  hi: "🇮🇳", ru: "🇷🇺", tr: "🇹🇷", nl: "🇳🇱", pl: "🇵🇱", sv: "🇸🇪",
};

const LANG_NAMES: Record<string, string> = {
  en: "English", es: "Spanish", fr: "French", de: "German", it: "Italian",
  pt: "Portuguese", ja: "Japanese", ko: "Korean", zh: "Chinese", ar: "Arabic",
  hi: "Hindi", ru: "Russian", tr: "Turkish", nl: "Dutch", pl: "Polish", sv: "Swedish",
};

function BroadcastControls({ sessionId }: { sessionId: string }) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const [translations, setTranslations] = useState<TranslationInfo[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const remoteParticipants = useRemoteParticipants();
  const captureStreamRef = useRef<MediaStream | null>(null);
  const publishedTrackRef = useRef<LocalAudioTrack | null>(null);

  // Count only real attendees, not translator bots
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
    fetchTranslations();
    const interval = setInterval(fetchTranslations, 3000);
    return () => clearInterval(interval);
  }, [fetchTranslations]);

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
  }, [localParticipant]);

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
          onClick={isCapturing ? stopCapture : startCapture}
          disabled={capturing}
          style={{
            width: "100%",
            padding: "14px 32px",
            fontFamily: "var(--font-body)",
            fontSize: "14px",
            fontWeight: 500,
            border: isCapturing ? "1px solid var(--error)" : "none",
            borderRadius: 0,
            background: isCapturing ? "transparent" : "var(--fg)",
            color: isCapturing ? "var(--error)" : "var(--bg)",
            cursor: capturing ? "wait" : "pointer",
            opacity: capturing ? 0.6 : 1,
          }}
        >
          {capturing
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
          Make sure "Share tab audio" is checked.
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
        <p className="mono" style={{ wordBreak: "break-all", textAlign: "center" }}>
          {joinUrl}
        </p>
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

      <hr className="rule" />

      {/* End */}
      <div style={{ paddingTop: 28 }}>
        <button
          className="btn-danger"
          onClick={() => {
            stopCapture();
            room.disconnect();
            window.location.href = "/";
          }}
          style={{ width: "100%" }}
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
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          width: "100%",
        }}
        onDisconnected={() => {
          setError("Disconnected from LiveKit room. Please check your credentials or network connection.");
        }}
      >

        <BroadcastControls sessionId={sessionId} />
      </LiveKitRoom>
    </div>
  );
}
