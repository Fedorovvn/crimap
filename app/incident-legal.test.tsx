import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { cleanup, render, screen } from "@testing-library/react";
import { IncidentLegal } from "./incident-legal";
import { isPublishableLegal, penaltyLabel } from "./legal-model";
import { starterLegal } from "../db/starter-legal";
import { IncidentParticipants } from "./incident-participants";
import { starterParticipants } from "../db/starter-participants";

// jsdom has no layout observer; actual tooltip placement is checked in the browser.
beforeEach(() => vi.stubGlobal("ResizeObserver", class {
  observe() {}
  unobserve() {}
  disconnect() {}
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const base = starterLegal["akacfa-homicide"][0];

describe("Legal context", () => {
  it("places each assessment only in its linked suspect card and does not guess missing links", () => {
    render(<IncidentParticipants participants={starterParticipants["akacfa-homicide"]} legal={[
      ...starterLegal["akacfa-homicide"],
      { ...base, key: "unlinked", participantKey: undefined, offense: "Без привязки" },
      { ...base, key: "wrong-role", participantKey: "victim", offense: "Не для потерпевшего" },
    ]} />);
    const first = screen.getByText("Мужчина, 40 лет").closest("article")!;
    const second = screen.getByText("Мужчина, 48 лет").closest("article")!;
    expect(first.textContent).toContain("5-15 лет лишения свободы");
    expect(first.textContent).not.toContain("до 3 лет лишения свободы");
    expect(second.textContent).toContain("до 3 лет лишения свободы");
    expect(second.textContent).not.toContain("5-15 лет лишения свободы");
    expect(screen.queryByText("Без привязки")).toBeNull();
    expect(screen.queryByText("Не для потерпевшего")).toBeNull();
    expect(screen.getAllByRole("region", { name: "Правовая квалификация" })).toHaveLength(2);
  });

  it("keeps separate suspects, source attribution, conditional statutory penalties and editorial mapping", () => {
    render(<IncidentLegal assessments={starterLegal["akacfa-homicide"]} />);
    expect(screen.getByText("40-летний подозреваемый").closest(".legal-entry")?.textContent).toContain("5-15 лет лишения свободы");
    expect(screen.getByText("48-летний подозреваемый").closest(".legal-entry")?.textContent).toContain("до 3 лет лишения свободы");
    expect(screen.getByRole("link", { name: "§ 160 (1)" }).getAttribute("href")).toBe(base.statutes[0].url);
    expect(screen.getByRole("link", { name: "Убийство" }).getAttribute("href")).toBe(base.source.url);
    expect(screen.getByRole("link", { name: "§ 160 (1)" }).getAttribute("title")).toContain("Если будет применён основной состав");
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(screen.getAllByRole("button", { name: "О правовой информации" })).toHaveLength(2);
  });

  it("shows the explanation on information-icon hover and dismisses it with Escape", async () => {
    const user = userEvent.setup();
    render(<IncidentLegal assessments={[base]} embedded />);
    expect(screen.queryByText(/Это справочное сопоставление/)).toBeNull();
    await user.hover(screen.getByRole("button", { name: "О правовой информации" }));
    expect((await screen.findByRole("tooltip")).textContent).toContain("меру пресечения и наказание определяет суд");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("does not publish unchecked, malformed or unsupported legal entries", () => {
    for (const entry of [
      { ...base, reviewStatus: "pending" }, { ...base, statutes: [] },
      { ...base, source: { ...base.source, kind: "media" } },
      { ...base, statutes: [{ ...base.statutes[0], url: "javascript:alert(1)" }] },
      { ...base, checkedAt: "yesterday" },
      { ...base, penalties: [{ kind: "imprisonment", min: 15, max: 5, unit: "years" }] },
    ]) expect(isPublishableLegal(entry)).toBe(false);
    render(<IncidentLegal assessments={[{ ...base, reviewStatus: "pending" }]} />);
    expect(screen.queryByRole("region", { name: "Правовая квалификация" })).toBeNull();
  });

  it("shows unconfirmed qualification and unknown penalties without inventing a sentence", () => {
    render(<IncidentLegal assessments={[{ ...base, qualification: "possible", penalties: [] }]} />);
    expect(screen.getByText(/Возможная квалификация, не подтверждена официально/)).toBeTruthy();
    expect(screen.getByText(/наказание пока не уточнено/)).toBeTruthy();
    expect(screen.queryByText(/5-15/)).toBeNull();
  });

  it("supports non-custodial sanctions and formats upper bounds", () => {
    expect(penaltyLabel({ kind: "fine", min: 10000, max: 50000, unit: "HUF" })).toContain("HUF");
    expect(penaltyLabel({ kind: "detention", max: 30, unit: "days" })).toBe("до 30 дней ареста");
    expect(penaltyLabel({ kind: "community-service", max: 100, unit: "hours" })).toBe("до 100 часов общественных работ");
    expect(penaltyLabel({ kind: "life-imprisonment" })).toBe("пожизненное лишение свободы");
    expect(penaltyLabel({ kind: "imprisonment", max: 1, unit: "years" })).toBe("до 1 года лишения свободы");
  });
});
