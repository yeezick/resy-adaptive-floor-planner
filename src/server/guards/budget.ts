// Dollar budgets tracked from the computed cost of every call.
//
// Every model call first reserves its worst-case cost (reservationUsd) and settles to the actual cost when the
// response arrives. `exhausted()` counts spent + still-reserved money, and is checked before every call, so
// concurrent runs cannot all start calls against the same remaining dollars. A call cancelled by the timeout
// is settled at its reserved amount (it may still have been billed). Worst case, spend passes the limit by at
// most one call's reservation.

export interface Hold {
  /** Replace the reservation with the actual cost. Idempotent: only the first settle counts. */
  settle(actualUsd: number): void;
}

/** What the agent loop needs from a budget. */
export interface SpendGate {
  exhausted(): boolean;
  reserve(usd: number): Hold;
}

export class SpendBudget implements SpendGate {
  protected spent = 0;
  protected reserved = 0;
  /** Largest single reservation seen (tests, logs). */
  largestReservation = 0;

  constructor(readonly limitUsd: number) {}

  protected roll(): void {}

  exhausted(): boolean {
    this.roll();
    return this.spent + this.reserved >= this.limitUsd;
  }

  reserve(usd: number): Hold {
    this.roll();
    this.reserved += usd;
    this.largestReservation = Math.max(this.largestReservation, usd);
    let open = true;
    return {
      settle: (actual: number) => {
        if (!open) return;
        open = false;
        this.reserved -= usd;
        this.spent += actual;
      },
    };
  }

  /** Record a cost that was not reserved (e.g. outside the agent loop). */
  add(usd: number): void {
    this.roll();
    this.spent += usd;
  }

  spentSoFar(): number {
    this.roll();
    return this.spent;
  }

  inFlightUsd(): number {
    this.roll();
    return this.reserved;
  }
}

/** Global daily budget for demo traffic. Resets at UTC midnight. */
export class DailyBudget extends SpendBudget {
  private day = "";

  constructor(
    limitUsd: number,
    private readonly now: () => Date = () => new Date(),
  ) {
    super(limitUsd);
  }

  static fromEnv(): DailyBudget {
    const n = Number(process.env.DAILY_BUDGET_USD ?? 5);
    return new DailyBudget(Number.isFinite(n) && n >= 0 ? n : 5);
  }

  protected override roll(): void {
    const today = this.now().toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.spent = 0; // reservations still in flight across midnight stay reserved
    }
  }

  spentToday(): number {
    return this.spentSoFar();
  }
}
