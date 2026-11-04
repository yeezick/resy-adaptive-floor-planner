import { afterEach, describe, expect, it } from "vitest";
import { demoIso, demoNow, demoStamp, receivedBy, resetDemoClock, setDemoNight } from "./demoClock";

afterEach(() => resetDemoClock());

describe("demo clock", () => {
  it("starts on the Wednesday live service and follows the night on screen", () => {
    expect(demoNow()).toEqual({ day: "Wed", clock: "19:10" });
    setDemoNight("book-fri", "15:00");
    expect(demoNow()).toEqual({ day: "Fri", clock: "15:00" });
    setDemoNight("custom-room", "12:00");
    expect(demoNow()).toEqual({ day: "Fri", clock: "15:00" });
  });

  it("stamps a decision on the demo clock, never the wall clock, in order", () => {
    setDemoNight("book-fri", "15:00");
    const a = demoStamp();
    const b = demoStamp();
    expect(a.at).toBe("Fri 15:00");
    expect(new Date(a.iso).getDate()).toBe(6);
    expect(new Date(a.iso).getHours()).toBe(15);
    expect(b.iso > a.iso).toBe(true);
  });

  it("reads fixture labels in the demo week", () => {
    expect(new Date(demoIso("Fri 14:40")).getDate()).toBe(6);
    expect(new Date(demoIso("Tue 09:12")).getHours()).toBe(9);
  });

  it("a request received after a night's clock is not known on that night", () => {
    expect(receivedBy("Fri 14:40", "Thu", "19:10")).toBe(false);
    expect(receivedBy("Fri 14:40", "Fri", "15:00")).toBe(true);
    expect(receivedBy("Fri 15:30", "Fri", "15:00")).toBe(false);
    expect(receivedBy("Wed 21:47", "Thu", "19:10")).toBe(true);
    expect(receivedBy("Fri 14:40", "Sat", "15:00")).toBe(true);
    expect(receivedBy("Wed 21:47", "Wed", "19:10")).toBe(false);
    expect(receivedBy("Tue 11:20", "Wed", "19:10")).toBe(true);
  });
});
