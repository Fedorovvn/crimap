import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REFERENCE_TIME } from "./incidents-model";
import { getIncidentSignals, getIncidentType, IncidentsView, type IncidentView } from "./incidents-view";

const incidents: IncidentView[] = [
  {
    id: 1,
    slug: "soroksari-fatal-crash",
    title: "Смертельное столкновение на Soroksári út",
    category: "ДТП",
    status: "В расследовании",
    verification: "Официальный источник",
    district: "IX · Ferencváros",
    locationLabel: "Soroksári út 160",
    locationPrecision: "Точный адрес из сообщения полиции",
    latitude: 47.4639,
    longitude: 19.0808,
    occurredAt: "2026-09-03T05:55:00+02:00",
    summary: "Водитель задержан после столкновения; один человек погиб.",
    updatedAt: "2026-09-04T11:50:00+02:00",
    sources: [
      {
        id: 11,
        sourceType: "Официально",
        outlet: "BRFK / police.hu",
        sourceUrl: "https://www.police.hu/example-soroksari",
        publishedAt: "2026-09-04T11:50:00+02:00",
        note: "Официальное сообщение.",
      },
    ],
    updates: [
      {
        id: 101,
        publishedAt: "2026-09-03T05:55:00+02:00",
        title: "Столкновение",
        detail: "Первое подтверждённое сообщение.",
        verification: "Официальный источник",
      },
    ],
    media: [],
  },
  {
    id: 2,
    slug: "akacfa-homicide",
    title: "Убийство на Akácfa utca",
    category: "Насильственное преступление",
    status: "Подозреваемые задержаны",
    verification: "Официальный источник",
    district: "VII · Erzsébetváros",
    locationLabel: "Akácfa utca",
    locationPrecision: "Улица; точный номер не раскрыт",
    latitude: 47.4992,
    longitude: 19.0664,
    occurredAt: "2026-09-18T01:40:00+02:00",
    summary: "Мужчину избили, он погиб; полиция задержала подозреваемых.",
    updatedAt: "2026-09-21T09:52:00+02:00",
    sources: [
      {
        id: 12,
        sourceType: "Официально",
        outlet: "BRFK / police.hu",
        sourceUrl: "https://www.police.hu/example-akacfa",
        publishedAt: "2026-09-21T09:52:00+02:00",
        note: "Официальное обновление.",
      },
      {
        id: 13,
        sourceType: "Неофициально",
        outlet: "Городское медиа",
        sourceUrl: "https://example.com/akacfa-report",
        publishedAt: "2026-09-21T10:10:00+02:00",
        note: "Свидетельское сообщение; требует проверки.",
      },
    ],
    updates: [
      {
        id: 102,
        publishedAt: "2026-09-21T09:52:00+02:00",
        title: "Подозреваемые задержаны",
        detail: "Полиция сообщила о задержании.",
        verification: "Официальный источник",
      },
      {
        id: 103,
        publishedAt: "2026-09-21T10:10:00+02:00",
        title: "Сообщение очевидца",
        detail: "Детали опубликованы городским медиа и пока не подтверждены полицией.",
        verification: "Неофициальная информация",
      },
    ],
    media: [
      {
        id: 201,
        imageUrl: "https://example.com/akacfa.jpg",
        sourceUrl: "https://example.com/akacfa-photo",
        outlet: "Index.hu",
        credit: "Mihádák Zoltán / MTI",
        caption: "Следователи на Akácfa utca.",
        isSensitive: true,
      },
    ],
  },
];

beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(REFERENCE_TIME); window.history.replaceState(null,'','/'); });
afterEach(() => { vi.restoreAllMocks(); });

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("IncidentsView", () => {
  it("switches between three languages and retains the chosen section without changing machine statuses", async () => {
    const user=userEvent.setup();
    const missing:IncidentView={...incidents[0],id:3,slug:'missing-person',eventType:'missing-person',category:'Пропавший человек',title:'Пропал человек',summary:'Идут поиски.',occurredAt:'2026-06-01T12:00:00Z',updates:[],media:[],participants:[],translations:{en:{'Пропал человек':'Missing person','Идут поиски.':'Search is ongoing.'},hu:{'Пропал человек':'Eltűnt személy','Идут поиски.':'A keresés folyamatban van.'}}};
    render(<IncidentsView incidents={[...incidents,missing]} />);
    expect(screen.getByText('Crime Map')).toBeTruthy();
    expect(screen.queryByText('Пропал человек')).toBeNull();
    await user.click(screen.getAllByRole('button',{name:'Пропавшие люди'})[1]);
    expect(screen.getAllByText('Пропал человек').length).toBeGreaterThan(0);
    expect(screen.queryByText(incidents[0].title)).toBeNull();
    expect(screen.getByRole('button',{name:'Всё время'}).getAttribute('aria-pressed')).toBe('true');
    await user.click(screen.getByRole('button',{name:'English'}));
    expect(screen.getAllByRole('button',{name:'Missing people'}).every(button=>button.getAttribute('aria-pressed')==='true')).toBe(true);
    expect(screen.getByText('Search is ongoing.')).toBeTruthy();
    expect(document.documentElement.lang).toBe('en');
    expect(window.localStorage.getItem('crime-map-language')).toBe('en');
    await user.click(screen.getByRole('button',{name:'Magyar'}));
    expect(screen.getByText('A keresés folyamatban van.')).toBeTruthy();
    expect(screen.getAllByRole('button',{name:'Eltűnt személyek'}).every(button=>button.getAttribute('aria-pressed')==='true')).toBe(true);
    expect(new URLSearchParams(window.location.search).get('section')).toBe('missing');
    await user.click(screen.getByRole('button',{name:'Русский'}));
    expect(screen.getByText('Идут поиски.')).toBeTruthy();
  });

  it("assigns the incident type and icon-only signals from verified facts", () => {
    expect(getIncidentType(incidents[0])).toBe("ДТП");
    expect(getIncidentSignals(incidents[0])).toEqual(["death", "suspect-detained"]);
    expect(getIncidentType(incidents[1])).toBe("Нападение");
    expect(getIncidentSignals(incidents[1])).toEqual(["death", "suspect-detained"]);
    expect(getIncidentSignals({ title: "Ограбление", status: "Подозреваемый разыскивается", summary: "" })).toEqual(["suspect-wanted"]);
  });

  it("renders the map, both incident cards and an official source", () => {
    render(<IncidentsView incidents={incidents} />);

    const map = screen.getByRole("region", { name: "Карта инцидентов Будапешта" });
    expect(map).toBeTruthy();
    expect(map.contains(screen.getByRole("button", { name: "Месяц" }))).toBe(true);
    expect(screen.getByLabelText("Всего 2 происшествий на карте").textContent).toBe("2");
    expect(screen.queryByText("Карта происшествий")).toBeNull();
    expect(screen.getAllByText("Смертельное столкновение на Soroksári út").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Убийство на Akácfa utca").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ДТП").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Нападение").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Есть погибшие").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Подозреваемый задержан").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /BRFK \/ police\.hu/i })).toHaveProperty(
      "href",
      "https://www.police.hu/example-soroksari",
    );
  });

  it("opens an incident when its card is pressed", async () => {
    const user = userEvent.setup();
    render(<IncidentsView incidents={incidents} />);

    await user.click(screen.getAllByRole("button", { name: /Убийство на Akácfa utca/ })[0]);

    expect(screen.getAllByText("Подозреваемые задержаны").length).toBeGreaterThan(1);
    expect(screen.getByText("Мужчину избили, он погиб; полиция задержала подозреваемых.")).toBeTruthy();
    expect(screen.getByText("Полиция сообщила о задержании.")).toBeTruthy();
    expect(screen.getByText("Неофициально").className).toContain("bg-[var(--status-bg)]");
    expect(screen.getByText("Неофициальная информация").className).toContain("bg-[var(--status-bg)]");
    expect(screen.getByRole("button", { name: "Показать чувствительное изображение" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Показать чувствительное изображение" }));
    expect(screen.queryByRole("button", { name: "Показать чувствительное изображение" })).toBeNull();
    expect(screen.getByRole("link", { name: "Index.hu" })).toHaveProperty("href", "https://example.com/akacfa-photo");
    expect(screen.queryByText("AI review")).toBeNull();
  });

  it("opens the mobile detail state and returns to the incident list", async () => {
    const user = userEvent.setup();
    render(<IncidentsView incidents={incidents} />);

    await user.click(screen.getAllByRole("button", { name: /Убийство на Akácfa utca/ })[0]);
    expect(screen.getByRole("main").getAttribute("data-mobile-detail")).toBe("true");

    await user.click(screen.getByRole("button", { name: "Назад к списку происшествий" }));
    expect(screen.getByRole("main").getAttribute("data-mobile-detail")).toBe("false");
  });

  it("changes visible cards and the selected dossier with the period filter", async () => {
    const user = userEvent.setup();
    render(<IncidentsView incidents={incidents} />);

    await user.click(screen.getByRole("button", { name: "7 дней" }));

    expect(screen.getByRole("button", { name: "7 дней" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("button", { name: "Открыть: Смертельное столкновение на Soroksári út" })).toBeNull();
    expect(screen.getByText("Мужчину избили, он погиб; полиция задержала подозреваемых.")).toBeTruthy();
  });

  it("shows the correct empty state for the last 24 hours", async () => {
    const user = userEvent.setup();
    render(<IncidentsView incidents={incidents} />);

    await user.click(screen.getByRole("button", { name: "24 ч" }));

    expect(screen.getByText("За этот период нет внесённых происшествий.")).toBeTruthy();
    expect(screen.getByLabelText("Всего 0 происшествий на карте").textContent).toBe("0");
    expect(screen.queryByText("AI review")).toBeNull();
  });

  it("does not crash when the database returns no incidents", () => {
    render(<IncidentsView incidents={[]} />);

    expect(screen.getByText("За этот период нет внесённых происшествий.")).toBeTruthy();
  });

  it("switches the interface and map between day and night themes", async () => {
    const user = userEvent.setup();
    render(<IncidentsView incidents={incidents} />);

    await user.click(screen.getByRole("button", { name: "Дневной режим" }));

    expect(screen.getByRole("button", { name: "Дневной режим" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("main").getAttribute("data-theme")).toBe("day");
    expect(window.localStorage.getItem("budapest-signal-theme")).toBe("day");
  });
});
