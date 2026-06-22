"use client";

import { useEffect, useState, useCallback, useRef, use } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useRoomContext,
  useTracks,
  useRemoteParticipants,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { Track, RoomEvent } from "livekit-client";
import { useSearchParams } from "next/navigation";
import LanguageSelector from "./components/LanguageSelector";

interface TranscriptEntry {
  id: string;
  text: string;
  language: string;
  final: boolean;
  timestamp: number;
}

function AttendeeView({
  sessionId,
  captionMode = false,
  initialLanguage = "original",
  initialTranslatorIdentity = null,
}: {
  sessionId: string;
  captionMode?: boolean;
  initialLanguage?: string;
  initialTranslatorIdentity?: string | null;
}) {
  const room = useRoomContext();
  const [currentLanguage, setCurrentLanguage] = useState(initialLanguage);
  const [translatorIdentity, setTranslatorIdentity] = useState<string | null>(
    initialTranslatorIdentity
  );
  const [isReceivingAudio, setIsReceivingAudio] = useState(false);
  const [isAudioMuted, setIsAudioMuted] = useState(captionMode);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [sessionName, setSessionName] = useState(sessionId);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const currentLanguageRef = useRef(currentLanguage);
  const remoteParticipants = useRemoteParticipants();
  const audioTracks = useTracks([Track.Source.Microphone]);

  useEffect(() => {
    try {
      const sessions = JSON.parse(localStorage.getItem("liveTranslateSessions") || "[]");
      const current = sessions.find((item: { sessionId: string }) => item.sessionId === sessionId);
      if (current?.name) window.setTimeout(() => setSessionName(current.name), 0);
    } catch {}
    fetch(`/api/sessions/${sessionId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (data?.name) setSessionName(data.name); })
      .catch(() => {});
  }, [sessionId]);

  const organizerParticipant = remoteParticipants.find((p) =>
    p.identity.startsWith("organizer-")
  );

  // Listen for transcription data from translator bots
  useEffect(() => {
    if (!room) return;

    const handleData = (
      payload: Uint8Array,
      participant: unknown,
      kind: unknown,
      topic: string | undefined,
    ) => {
      if (topic === "transcription-history") {
        try {
          const data = JSON.parse(new TextDecoder().decode(payload));
          if (data.type !== "transcription-history" || !Array.isArray(data.entries)) return;
          setTranscripts((prev) => {
            const merged = [...prev];
            for (const entry of data.entries as TranscriptEntry[]) {
              if (entry.language !== currentLanguageRef.current) continue;
              if (!merged.some((item) => item.id === entry.id)) merged.push(entry);
            }
            return merged.sort((a, b) => a.timestamp - b.timestamp).slice(-50);
          });
        } catch {}
        return;
      }

      // Only handle transcription topic
      if (topic !== "transcription") return;

      try {
        const data = JSON.parse(new TextDecoder().decode(payload));
        if (data.type !== "transcription") return;

        // Only show transcriptions for the currently selected language
        if (data.language !== currentLanguageRef.current) return;

        setTranscripts((prev) => {
          const existing = prev.findIndex((t) => t.id === data.segmentId);
          const entry: TranscriptEntry = {
            id: data.segmentId,
            text: data.text,
            language: data.language,
            final: data.final,
            timestamp: data.timestamp,
          };

          if (existing >= 0) {
            const updated = [...prev];
            updated[existing] = {
              ...updated[existing],
              text: updated[existing].text + data.text,
              final: data.final,
            };
            return updated;
          }

          const next = [...prev, entry];
          return next.slice(-50);
        });
      } catch {
        // Not a JSON transcription message
      }
    };

    room.on(RoomEvent.DataReceived, handleData);
    return () => {
      room.off(RoomEvent.DataReceived, handleData);
    };
  }, [room]);

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcripts]);

  // Manage which audio tracks are subscribed based on selected language
  // autoSubscribe: false means nothing plays by default
  // We explicitly subscribe only to the selected language's track
  useEffect(() => {
    if (!room) return;

    const updateSubscriptions = () => {
      const participants = room.remoteParticipants;

      for (const [, participant] of participants) {
        const isOrganizer = participant.identity.startsWith("organizer-");
        const isSelectedTranslator =
          translatorIdentity && participant.identity === translatorIdentity;

        for (const [, pub] of participant.trackPublications) {
          if (pub.kind === Track.Kind.Audio) {
            if (isAudioMuted) {
              pub.setSubscribed(false);
            } else if (currentLanguage === "original") {
              pub.setSubscribed(isOrganizer);
            } else {
              pub.setSubscribed(!!isSelectedTranslator);
            }
          }
        }
      }
    };

    updateSubscriptions();

    const handleUpdate = () => updateSubscriptions();
    room.on(RoomEvent.TrackPublished, handleUpdate);
    room.on(RoomEvent.ParticipantConnected, handleUpdate);

    return () => {
      room.off(RoomEvent.TrackPublished, handleUpdate);
      room.off(RoomEvent.ParticipantConnected, handleUpdate);
    };
  }, [room, currentLanguage, translatorIdentity, remoteParticipants, isAudioMuted]);

  useEffect(() => {
    const hasAudio = audioTracks.some((t) => {
      const pub = t.publication;
      if (currentLanguage === "original") {
        return t.participant.identity.startsWith("organizer-") && pub.isSubscribed;
      } else {
        return (
          translatorIdentity &&
          t.participant.identity === translatorIdentity &&
          pub.isSubscribed
        );
      }
    });
    window.setTimeout(() => setIsReceivingAudio(hasAudio), 0);
  }, [audioTracks, currentLanguage, translatorIdentity]);

  // Unsubscribe from translation when tab closes
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Use sendBeacon for reliable fire-and-forget during page unload
      if (!captionMode && currentLanguageRef.current && currentLanguageRef.current !== "original") {
        const body = JSON.stringify({
          sessionId,
          targetLanguage: currentLanguageRef.current,
        });
        navigator.sendBeacon(
          "/api/translate/unsubscribe",
          new Blob([body], { type: "application/json" })
        );
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      // Also fire on React unmount (e.g. navigation away)
      handleBeforeUnload();
    };
  }, [sessionId, captionMode]);

  const handleLanguageChange = useCallback(
    (langCode: string, newTranslatorIdentity: string | null) => {
      // Unsubscribe from the previous language
      const prev = currentLanguageRef.current;
      if (prev && prev !== "original" && prev !== langCode) {
        fetch("/api/translate/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, targetLanguage: prev }),
        }).catch(() => {});
      }

      setCurrentLanguage(langCode);
      currentLanguageRef.current = langCode;
      setTranslatorIdentity(newTranslatorIdentity);
      // Clear transcripts when switching languages
      setTranscripts([]);
    },
    [sessionId]
  );

  const isConnected = organizerParticipant !== undefined;
  const latestTranscript = transcripts.at(-1)?.text || "";
  const captionUrl = `/session/${sessionId}/watch?mode=caption${
    currentLanguage !== "original"
      ? `&lang=${encodeURIComponent(currentLanguage)}&translator=${encodeURIComponent(
          translatorIdentity || ""
        )}`
      : ""
  }`;

  if (captionMode) {
    return (
      <div className="caption-shell">
        <p className="caption-line">
          {latestTranscript ||
            (currentLanguage === "original"
              ? "Select a language in the normal listener page first."
              : "Waiting for translated speech…")}
        </p>
        <div ref={transcriptEndRef} />
      </div>
    );
  }

  return (
    <div className="container enter">
      {/* Header */}
      <div style={{ marginBottom: 40 }}>
        <h1 className="display display-lg" style={{ marginBottom: 8 }}>
          <em>Listening</em>
        </h1>
        <p style={{ marginBottom: 4, fontWeight: 500 }}>{sessionName}</p>
        <p className="mono">{sessionId}</p>
      </div>

      {/* Status */}
      <div style={{ marginBottom: 32 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div className={`waveform ${isReceivingAudio ? "active" : "idle"}`}>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="waveform-bar" />
              ))}
            </div>

            {isConnected ? (
              <span className="status status--active">
                <span className="status-dot pulse" />
                {currentLanguage === "original"
                  ? "Original"
                  : currentLanguage.toUpperCase()}
              </span>
            ) : (
              <span className="status status--waiting">
                <span className="status-dot pulse" />
                Waiting for broadcast
              </span>
            )}
          </div>

          <button
            onClick={() => setIsAudioMuted((m) => !m)}
            style={{
              fontFamily: "var(--font-body)",
              fontSize: 12,
              fontWeight: 500,
              padding: "6px 14px",
              border: isAudioMuted ? "1px solid var(--error)" : "1px solid var(--border)",
              borderRadius: 0,
              background: isAudioMuted ? "var(--error-soft)" : "transparent",
              color: isAudioMuted ? "var(--error)" : "var(--fg-secondary)",
              cursor: "pointer",
            }}
          >
            {isAudioMuted ? "🔇 Muted" : "🔊 On"}
          </button>
          <button
            onClick={() =>
              window.open(
                captionUrl,
                "live-translate-caption",
                "width=520,height=180,menubar=no,toolbar=no,location=no,status=no"
              )
            }
            style={{
              fontFamily: "var(--font-body)",
              fontSize: 12,
              fontWeight: 500,
              padding: "6px 14px",
              border: "1px solid var(--border)",
              borderRadius: 0,
              background: "transparent",
              color: "var(--fg-secondary)",
              cursor: "pointer",
            }}
          >
            Caption mode
          </button>
        </div>
      </div>

      <hr className="rule" />

      {/* Language selector */}
      <div style={{ padding: "28px 0" }}>
        <LanguageSelector
          sessionId={sessionId}
          currentLanguage={currentLanguage}
          onLanguageChange={handleLanguageChange}
        />
      </div>

      <hr className="rule" />

      {/* Transcription output */}
      <div style={{ padding: "28px 0" }}>
        <button
          onClick={() => setHistoryOpen((open) => !open)}
          style={{ display: "flex", width: "100%", justifyContent: "space-between", border: "none", background: "transparent", cursor: "pointer", padding: 0, marginBottom: 16 }}
        >
          <span className="label">Transcript History</span>
          <span className="mono">{historyOpen ? "Hide" : "Show"}</span>
        </button>

        {historyOpen && (
        <div
          style={{
            maxHeight: 240,
            overflowY: "auto",
            paddingRight: 8,
          }}
        >
          {transcripts.length === 0 ? (
            <p className="body-sm italic">
              {currentLanguage === "original"
                ? "Select a language to see transcription"
                : "Waiting for translated speech…"}
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {transcripts.map((t, i) => (
                <p
                  key={`${t.id}-${i}`}
                  style={{
                    fontFamily: "var(--font-body)",
                    fontSize: 15,
                    lineHeight: 1.6,
                    color: "var(--fg)",
                    fontWeight: t.final ? 500 : 400,
                  }}
                >
                  {t.text}
                </p>
              ))}
              <div ref={transcriptEndRef} />
            </div>
          )}
        </div>
        )}
      </div>

      <hr className="rule" />

      {/* Info */}
      <p className="body-sm" style={{ paddingTop: 28 }}>
        Each language activates a dedicated Gemini Live API session
        for real-time translation.
      </p>
    </div>
  );
}


export default function WatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: sessionId } = use(params);
  const searchParams = useSearchParams();
  const captionMode = searchParams.get("mode") === "caption";
  const initialLanguage = searchParams.get("lang") || "original";
  const initialTranslatorIdentity = searchParams.get("translator");
  const [token, setToken] = useState("");
  const [livekitUrl, setLivekitUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(captionMode);

  useEffect(() => {
    async function fetchToken() {
      try {
        const identity = `attendee-${Math.random().toString(36).slice(2, 8)}`;
        const res = await fetch(
          `/api/token?room=${sessionId}&identity=${identity}&role=attendee`
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
          <button
            className="btn btn-outline"
            onClick={() => window.location.reload()}
          >
            Retry
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
          <p className="mono">Joining…</p>
        </div>
      </div>
    );
  }

  if (!started) {
    return (
      <div className="page">
        <div className="container enter" style={{ textAlign: "center" }}>
          <h1 className="display display-lg" style={{ marginBottom: 12 }}>
            <em>Ready</em>
          </h1>
          <p className="body-sm" style={{ marginBottom: 40 }}>
            Tap below to join the broadcast and enable audio.
          </p>
          <button
            className="btn"
            onClick={() => setStarted(true)}
          >
            Start listening
          </button>
          <p className="mono" style={{ marginTop: 32, fontSize: 12 }}>
            Session {sessionId}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={captionMode ? "page caption-page" : "page page-top"}>
      <LiveKitRoom
        key={token}
        video={false}
        audio={false}
        token={token}
        serverUrl={livekitUrl}
        connectOptions={{ autoSubscribe: false }}
        onDisconnected={() => {
          setError("Reconnecting…");
          window.setTimeout(() => window.location.reload(), 1500);
        }}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          width: "100%",
        }}
      >
        <RoomAudioRenderer />
        <AttendeeView
          sessionId={sessionId}
          captionMode={captionMode}
          initialLanguage={initialLanguage}
          initialTranslatorIdentity={initialTranslatorIdentity}
        />
      </LiveKitRoom>
    </div>
  );
}
