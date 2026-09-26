import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { IncidentParticipants } from "./incident-participants";
import { ageLabel, avatarFor, countryFlag, participantsForDisplay, participantStatusLabel, type Participant } from "./participants-model";
import { starterParticipants } from "../db/starter-participants";

afterEach(cleanup);

describe("Participant information", () => {
  it("chooses a silhouette from known age and gender and preserves unknowns", () => {
    expect(avatarFor({ kind: "person", age: 62, gender: "male" })).toBe("elderly-male");
    expect(avatarFor({ kind: "person", age: 8, gender: "female" })).toBe("girl");
    expect(avatarFor({ kind: "person", age: 10 })).toBe("child-neutral");
    expect(avatarFor({ kind: "person" })).toBe("person-neutral");
    expect(avatarFor({ kind: "person", age: 17, gender: "male", ageGroup: "adult" })).toBe("boy");
    expect(ageLabel(11)).toBe("11 лет");
    expect(ageLabel(21)).toBe("21 год");
    expect(ageLabel(62)).toBe("62 года");
  });

  it("shows sourced participant facts without assigning citizenship or guilt", () => {
    render(<IncidentParticipants participants={starterParticipants["akacfa-homicide"]} />);
    expect(screen.getByText("Подозреваемые")).toBeTruthy();
    expect(screen.queryByText("Осуждённые")).toBeNull();
    expect(screen.getAllByText("Задержан")).toHaveLength(2);
    expect(screen.getByText("Мужчина, 40 лет")).toBeTruthy();
    expect(screen.getByText("Мужчина, 48 лет")).toBeTruthy();
    expect(screen.getByText(/36 лет/)).toBeTruthy();
    expect(screen.queryByText("Гражданство не указано")).toBeNull();
    expect(screen.queryByText("Предполагаемый лидер")).toBeNull();
  });

  it("shows four people separately but keeps five as a group", () => {
    const base = starterParticipants["akacfa-homicide"][0];
    const four = participantsForDisplay([{ ...base, profile: { kind: "group", count: 4, gender: "male" } }]);
    expect(four).toHaveLength(4);
    expect(four.every((p) => p.profile.kind === "person" && p.status === base.status && p.sourceUrl === base.sourceUrl)).toBe(true);
    const five: Participant = { ...base, profile: { kind: "group", count: 5 } };
    expect(participantsForDisplay([five])).toEqual([five]);
    expect(avatarFor(five.profile)).toBe("group");
    expect(avatarFor({ kind: "group" })).toBe("person-neutral");
  });

  it("shows the wanted notice only while the participant is wanted", () => {
    const person: Participant = { ...starterParticipants["akacfa-homicide"][0], status: "wanted", wantedNotice: { description: "Тестовые приметы", isDemo: true, sourceUrl: "https://example.org/notice" } };
    const view = render(<IncidentParticipants participants={[person]} />);
    expect(screen.getByText("Ориентировка · тестовый пример")).toBeTruthy();
    expect(screen.getByText(/Это не действующая ориентировка/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Открыть источник ориентировки/, hidden: true }).getAttribute("href")).toBe("https://example.org/notice");
    view.rerender(<IncidentParticipants participants={[{ ...person, status: "detained" }]} />);
    expect(screen.queryByText("Ориентировка · тестовый пример")).toBeNull();
    expect(screen.getByText("Задержан")).toBeTruthy();
  });

  it("includes the known leader once when splitting a small group", () => {
    const leader = { person: { kind: "person", gender: "female", age: 32, name: "Тестовая участница" } as const, status: "wanted" as const, sourceUrl: "https://example.org/leader" };
    const people = participantsForDisplay([{ ...starterParticipants["akacfa-homicide"][0], profile: { kind: "group", count: 2, leader } }]);
    expect(people).toHaveLength(2);
    expect(people[0].profile).toEqual(leader.person);
    expect(people[0].status).toBe("wanted");
    expect(people[0].sourceUrl).toBe(leader.sourceUrl);
    expect(people[1].profile).toEqual({ kind: "person", gender: undefined });
  });

  it("supports large groups with a separately sourced leader and country", () => {
    const group: Participant = { ...starterParticipants["akacfa-homicide"][0], profile: {
      kind: "group", count: 25, leader: { person: { kind: "person", name: "Тестовая участница", gender: "female", age: 40, citizenship: { code: "HU", name: "Венгрия" } }, status: "wanted", sourceUrl: "https://example.org/leader" },
    } };
    render(<IncidentParticipants participants={[group]} />);
    expect(screen.getByText("×25")).toBeTruthy();
    expect(screen.getByText("Предполагаемый лидер")).toBeTruthy();
    expect(screen.getByText("В розыске")).toBeTruthy();
    expect(screen.getByText(/Гражданство: Венгрия/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Источник сведений о лидере/ }).getAttribute("href")).toBe("https://example.org/leader");
    expect(countryFlag("HU")).toBe("🇭🇺");
    expect(countryFlag("unknown")).toBe("");
    expect(participantStatusLabel("detained", { kind: "person", gender: "female" })).toBe("Задержана");
  });
});
