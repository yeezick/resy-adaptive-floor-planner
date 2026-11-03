import type { Room } from "../../domain";

type Inventory = Room["inventory"];

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="field-inline storage-field">
      <span>{label}</span>
      <input
        type="number"
        min={0}
        max={999}
        value={value}
        onChange={(e) => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
      />
    </label>
  );
}

/** Storage inventory: what can be brought out tonight beyond the tables on the floor. */
export function StorageEditor({
  inv,
  onChange,
}: {
  inv: Inventory;
  onChange: (i: Inventory) => void;
}) {
  const spares = inv.spareTables;
  const setSpare = (i: number, patch: Partial<{ seats: number; count: number }>) =>
    onChange({ ...inv, spareTables: spares.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  return (
    <section className="storage-editor" aria-label="Storage inventory">
      <h3 className="section-title">Storage inventory</h3>
      <NumberField
        label="Extenders"
        value={inv.extenders}
        onChange={(n) => onChange({ ...inv, extenders: n })}
      />
      <NumberField
        label="Spare chairs"
        value={inv.spareChairs}
        onChange={(n) => onChange({ ...inv, spareChairs: n })}
      />
      <div className="small muted">Spare tables by size</div>
      {spares.map((s, i) => (
        <div key={i} className="spare-row">
          <NumberField
            label="Seats"
            value={s.seats}
            onChange={(n) => setSpare(i, { seats: Math.max(1, n) })}
          />
          <NumberField label="Count" value={s.count} onChange={(n) => setSpare(i, { count: n })} />
          <button
            type="button"
            aria-label={`Remove ${s.seats}-seat spares`}
            onClick={() => onChange({ ...inv, spareTables: spares.filter((_, j) => j !== i) })}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange({ ...inv, spareTables: [...spares, { seats: 4, count: 1 }] })}
      >
        Add size
      </button>
    </section>
  );
}
