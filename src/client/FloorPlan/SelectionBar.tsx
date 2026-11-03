import { checkCombine, comboOf, type Room } from "../../domain";
import { tablesPhrase } from "../../domain/wording";

/** Why a combine is or isn't possible right now (the same checks applyCombine runs). */
export function combineStatus(room: Room, ids: string[]): { ok: boolean; text: string } {
  if (ids.length < 2)
    return { ok: false, text: "Select two or more adjacent joinable tables to combine." };
  const check = checkCombine(room, ids);
  if (!check.ok) return { ok: false, text: check.reason };
  const taken = ids.find((id) => comboOf(room, id));
  if (taken) return { ok: false, text: `${taken} is already combined; split it first` };
  return { ok: true, text: `Legal combine: ${check.seats} seats` };
}

interface Props {
  room: Room;
  selected: string[];
  onCombine: (ids: string[]) => void;
  onSplit: (ids: string[]) => void;
  onClear: () => void;
}

export function SelectionBar({ room, selected, onCombine, onSplit, onClear }: Props) {
  const status = combineStatus(room, selected);
  const canSplit = selected.some((id) => comboOf(room, id));
  return (
    <div className="selection-bar">
      <div className="selection-label small">
        {selected.length ? (
          <>
            Selected <strong>{tablesPhrase(selected)}</strong>
          </>
        ) : (
          <span className="muted">Click tables on the floor to select · drag to move</span>
        )}
      </div>
      <div className="btn-row">
        <button
          type="button"
          className="primary"
          disabled={!status.ok}
          onClick={() => onCombine(selected)}
          aria-describedby="combine-status"
        >
          Combine
        </button>
        <button type="button" disabled={!canSplit} onClick={() => onSplit(selected)}>
          Split
        </button>
        <button type="button" disabled={!selected.length} onClick={onClear}>
          Clear
        </button>
      </div>
      <div id="combine-status" className={`small ${status.ok ? "ok-text" : "muted"}`}>
        {selected.length >= 2 && !status.ok ? `Can't combine: ${status.text}` : status.text}
      </div>
    </div>
  );
}
