import { useState } from "react";
import { fetchRoom, fetchRooms } from "./api";
import { useAsync } from "./lib/useAsync";
import { LayoutHost } from "./LayoutHost";

const DEFAULT_ROOM = "dinner-peak";

// Stable loaders for useAsync. Keys carry a retry counter after "#".
const loadRooms = () => fetchRooms();
const loadRoom = (key: string) => fetchRoom(key.split("#")[0] ?? DEFAULT_ROOM);

export function PlannerPage() {
  const [roomId, setRoomId] = useState(DEFAULT_ROOM);
  const [retry, setRetry] = useState(0);
  const rooms = useAsync(`rooms#${retry}`, loadRooms);
  const room = useAsync(`${roomId}#${retry}`, loadRoom);

  const options =
    rooms?.ok && rooms.data.length
      ? rooms.data
      : [
          { id: "dinner-peak", name: "Dinner peak", clock: "" },
          { id: "next-day", name: "Next day", clock: "" },
        ];

  const roomSelect = (
    <label className="room-select">
      <span className="sr-only">Room</span>
      <select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
        {options.map((r) => (
          <option key={r.id} value={r.id}>
            {r.id}
            {r.clock ? ` · ${r.clock}` : ""}
          </option>
        ))}
      </select>
    </label>
  );

  if (room?.ok) {
    return (
      <LayoutHost key={`${room.data.id}#${retry}`} fixture={room.data} roomSelect={roomSelect} />
    );
  }

  return (
    <div className="console">
      <div className="console-bar">
        <div className="cb-room">{roomSelect}</div>
        {rooms && !rooms.ok && (
          <span className="muted small">Room list unavailable — showing defaults.</span>
        )}
      </div>
      {room === undefined && <div className="state-card">Loading room…</div>}
      {room && !room.ok && (
        <div className="state-card error" role="alert">
          <h2>Can't load the room</h2>
          <p>
            {room.error.code === "network" || room.error.code === "bad_response"
              ? "The API server isn't responding. Start it with `pnpm dev` and retry."
              : room.error.message}
          </p>
          {room.error.code === "bad_response" && (
            <pre className="error-detail">{room.error.message}</pre>
          )}
          <button type="button" onClick={() => setRetry((n) => n + 1)}>
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
