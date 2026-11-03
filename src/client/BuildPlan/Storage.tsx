import type { BuildPlan, Room } from "../../domain";

interface Props {
  inventory: Room["inventory"];
  totals: BuildPlan["totals"];
}

interface Line {
  label: string;
  used: number;
  stock: number;
  note?: string;
}

/**
 * The build plan counts spare tables as 4-tops (any spare seating 4+). Attribute usage to the 4-top
 * stock first, then larger sizes; smaller spares are not used by builds.
 */
function spareLines(inv: Room["inventory"], used: number): Line[] {
  const sizes = [...inv.spareTables].sort((a, b) => a.seats - b.seats);
  let left = used;
  const usedBy = new Map<number, number>();
  for (const s of sizes.filter((s) => s.seats >= 4)) {
    const n = Math.min(left, s.count);
    usedBy.set(s.seats, n);
    left -= n;
  }
  return [...sizes]
    .sort((a, b) => b.seats - a.seats)
    .map((s) => ({
      label: `Spare ${s.seats}-tops`,
      used: usedBy.get(s.seats) ?? 0,
      stock: s.count,
      note: s.seats < 4 ? "not used for builds" : undefined,
    }));
}

export function Storage({ inventory: inv, totals }: Props) {
  const lines: Line[] = [
    { label: "Extenders", used: totals.extenders, stock: inv.extenders },
    { label: "Chairs", used: totals.extraChairs, stock: inv.spareChairs },
    ...spareLines(inv, totals.spareTables),
  ];
  return (
    <section className="storage" aria-label="Storage">
      <h3 className="section-title">Storage · used / in stock</h3>
      <table className="data compact">
        <tbody>
          {lines.map((l) => {
            const ratio = l.stock ? Math.min(1, l.used / l.stock) : l.used ? 1 : 0;
            const over = l.used > l.stock;
            return (
              <tr key={l.label}>
                <th scope="row">
                  {l.label}
                  {l.note && <span className="muted"> · {l.note}</span>}
                </th>
                <td className={`num${over ? " warn-text" : ""}`}>
                  {l.used} / {l.stock}
                </td>
                <td className="bar-cell" aria-hidden="true">
                  <span className="meter">
                    <span
                      className={over || ratio === 1 ? "meter-fill is-full" : "meter-fill"}
                      style={{ width: `${ratio * 100}%` }}
                    />
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
