import { useEffect, useMemo, useState } from "react";
import { fetchRoom, fetchRooms } from "./api";
import { requestsActions, startRequests, useRequests } from "./requests/store";
import { useAsync } from "./lib/useAsync";
import { LayoutHost } from "./LayoutHost";
import { nightLabel } from "./nights";

const DEFAULT_ROOM = "dinner-peak";

// Stable loaders for useAsync. Keys carry a retry counter after "#".
const loadRooms = () => fetchRooms();
const loadRoom = (key: string) => fetchRoom(key.split("#")[0] ?? DEFAULT_ROOM);

export function PlannerPage() {
  const [chosenRoom, setRoomId] = useState(DEFAULT_ROOM);
  const [retry, setRetry] = useState(0);
  const rooms = useAsync(`rooms#${retry}`, loadRooms);
  const requests = useRequests();
  useEffect(startRequests, []);
  // Accept on a request opens that night's plan, until the host picks another room.
  const openPlan = requests.openPlan;
  const roomId = openPlan?.roomId ?? chosenRoom;
  const room = useAsync(`${roomId}#${retry}`, loadRoom);
  // The night's book plus parties accepted from requests this session.
  const accepted = useMemo(() => requests.accepted[roomId] ?? [], [requests.accepted, roomId]);
  const fixture = useMemo(
    () =>
      room?.ok
        ? {
            ...room.data,
            reservations: [
              ...room.data.reservations,
              ...accepted.filter((a) => !room.data.reservations.some((r) => r.id === a.id)),
            ],
          }
        : null,
    [room, accepted],
  );
  const focusRequest = openPlan?.roomId === roomId ? openPlan.requestId : undefined;

  const options =
    rooms?.ok && rooms.data.length
      ? rooms.data
      : [
          { id: "dinner-peak", name: "Dinner peak", clock: "" },
          { id: "next-day", name: "Next day", clock: "" },
        ];

  const roomSelect = (
    <label className="room-select">
      <span className="sr-only">Night</span>
      <select
        value={roomId}
        onChange={(e) => {
          requestsActions.consumeOpenPlan();
          setRoomId(e.target.value);
        }}
      >
        {options.map((r) => (
          <option key={r.id} value={r.id}>
            {nightLabel(r.id, r.clock)}
          </option>
        ))}
      </select>
    </label>
  );

  if (room?.ok && fixture && room.data.id === roomId) {
    return (
      <LayoutHost
        key={`${room.data.id}#${retry}#${accepted.map((a) => a.id).join(",")}#${openPlan?.seq ?? ""}`}
        fixture={fixture}
        roomSelect={roomSelect}
        focusRequest={focusRequest}
        focusView={openPlan?.view}
      />
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
