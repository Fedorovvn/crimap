import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ContextClaims } from "./context-claims";
import { IncidentParticipants } from "./incident-participants";
import { contextOriginLabel, isPublishableContext, type ContextClaim } from "./context-model";
import { starterContext } from "../db/starter-context";
import { starterParticipants } from "../db/starter-participants";

afterEach(cleanup);
const base = starterContext["akacfa-homicide"][0];

describe("Attributed context", () => {
  it("keeps a media report next to its participant with evidence and uncertainty", () => {
    render(<IncidentParticipants participants={starterParticipants["akacfa-homicide"]} context={starterContext["akacfa-homicide"]} />);
    const links = screen.getAllByRole("link", { name: "Index" });
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute("title")).toContain("Неофициально");
    expect(links[0].getAttribute("title")).toContain("Не подтверждено независимо");
    expect(links[0].closest("p")?.textContent).toBe(base.text);
    expect(links[0].getAttribute("href")).toBe(base.evidence[0].url);
    expect(links[0].closest(".participant-card")?.textContent).toContain("Потерпевший");
    expect(links[0].closest(".participant-card")?.textContent).not.toContain("Подозреваемый 1");
  });

  it("does not publish pending or unsupported claims", () => {
    render(<ContextClaims claims={[{ ...base, reviewStatus: "pending" }, { ...base, key: "no-evidence", evidence: [] }]} />);
    expect(screen.queryByText(base.text)).toBeNull();
    expect(isPublishableContext({ ...base, evidence: [{ ...base.evidence[0], url: "javascript:alert(1)" }] })).toBe(false);
  });

  it("does not turn background official links into official support", () => {
    expect(contextOriginLabel({ ...base, evidence: [...base.evidence, { kind: "official", url: "https://example.com/police", label: "Полиция", relation: "background" }] })).toBe("Неофициально");
  });

  it("requires a reviewed explanation for model hypotheses and forbids model personal guesses", () => {
    const hypothesis: ContextClaim = { ...base, origin: "model", topic: "circumstances", subject: { kind: "event" }, rationale: "Сопоставлены опубликованные время и место." };
    expect(isPublishableContext(hypothesis)).toBe(true);
    expect(isPublishableContext({ ...hypothesis, rationale: undefined })).toBe(false);
    expect(isPublishableContext({ ...hypothesis, topic: "citizenship" })).toBe(false);
    expect(isPublishableContext({ ...hypothesis, subject: { kind: "participant", participantKey: "victim" } })).toBe(false);
    expect(isPublishableContext({ ...hypothesis, verification: "corroborated" })).toBe(false);
    render(<ContextClaims claims={[hypothesis]} />);
    expect(screen.getByText("Гипотеза модели")).toBeTruthy();
    expect(screen.getByText("Предположение, не установленный факт")).toBeTruthy();
  });

  it("keeps group information scoped to the group when showing fewer than five people", () => {
    const groupClaim: ContextClaim = { ...base, subject: { kind: "participant", participantKey: "suspects" } };
    render(<IncidentParticipants participants={[{ ...starterParticipants["akacfa-homicide"][0], key: "suspects", label: "Двое подозреваемых", profile: { kind: "group", count: 2 } }]} context={[groupClaim]} />);
    expect(screen.getAllByRole("link", { name: "Index" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Index" }).closest(".participant-card")).toBeNull();
    expect(screen.getByRole("region", { name: "О группе: Двое подозреваемых" })).toBeTruthy();
  });

  it("retains corrections visibly without silently erasing the old report", () => {
    render(<ContextClaims claims={[{ ...base, verification: "retracted" }]} />);
    expect(screen.getByText("Сведения отозваны")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Index" }).closest("p")?.getAttribute("data-verification")).toBe("retracted");
  });
});
