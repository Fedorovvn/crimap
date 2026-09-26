"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type SVGProps } from "react";
import { ArrowLeftIcon, CarFrontIcon, CrossIcon, MapPinIcon, SearchIcon, ShieldAlertIcon, SkullIcon, SwordsIcon, TriangleAlertIcon, WalletCardsIcon } from "lucide-react";
import { filterIncidents, PERIODS, selectVisibleIncident } from "./incidents-model";
import { HandcuffsIcon } from "./incident-icons";
import { IncidentParticipants } from "./incident-participants";
import type { Participant } from "./participants-model";
import type { ContextClaim } from "./context-model";
import { ContextClaims } from "./context-claims";
import type { LegalAssessment } from "./legal-model";

const IncidentMap = dynamic(
  () => import("./incident-map").then((module) => module.IncidentMap),
  {
    ssr: false,
    loading: () => <div className="grid h-full w-full place-items-center bg-[var(--map-loading)] text-sm font-medium text-[var(--muted-text)]">Загрузка карты…</div>,
  },
);

export type IncidentView = {
  eventType?: string;
  signals?: IncidentSignal[];
  context?: ContextClaim[];
  legal?: LegalAssessment[];
  participants?: Participant[];
  id: number;
  slug: string;
  title: string;
  category: string;
  status: string;
  verification: string;
  district: string;
  locationLabel: string;
  locationPrecision: string;
  latitude: number;
  longitude: number;
  occurredAt: string;
  summary: string;
  updatedAt: string;
  sources: {
    id: number;
    sourceType: string;
    outlet: string;
    sourceUrl: string;
    publishedAt: string;
    note: string;
  }[];
  updates: {
    id: number;
    publishedAt: string;
    title: string;
    detail: string;
    verification: string;
  }[];
  media: {
    id: number;
    imageUrl: string;
    sourceUrl: string;
    outlet: string;
    credit: string;
    caption: string;
    isSensitive: boolean;
  }[];
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Budapest",
  }).format(new Date(value));
}

function isOfficialInformation(label: string) {
  return !/неофициаль/i.test(label) && /официаль|police|brfk/i.test(label);
}

function IncidentMediaGallery({ incident }: { incident: IncidentView }) {
  const { media } = incident;
  const [revealedIds, setRevealedIds] = useState<number[]>([]);

  if (!media.length) return null;

  return (
    <section className="incident-media-gallery mt-6" aria-label="Фотографии с места">
      <div className="grid gap-3">
        {media.map((item, index) => {
          const concealed = item.isSensitive && !revealedIds.includes(item.id);

          return (
            <figure key={item.id} className="overflow-hidden rounded-2xl bg-[var(--card)]">
              <div className="incident-photo relative overflow-hidden bg-[var(--map-loading)]">
                <img
                  src={item.imageUrl}
                  alt={item.caption}
                  className={`block h-auto w-full transition duration-500 ${concealed ? "scale-110 blur-2xl" : ""}`}
                  decoding="async"
                />
                {concealed && (
                  <button
                    type="button"
                    onClick={() => setRevealedIds((ids) => [...ids, item.id])}
                    aria-label="Показать чувствительное изображение"
                    className="absolute inset-0 grid place-items-center bg-black/25 p-5 text-center text-sm font-semibold text-white"
                  >
                    <span className="rounded-full bg-black/65 px-4 py-2.5">Чувствительное изображение · показать</span>
                  </button>
                )}
                {index === 0 && (
                  <div className="incident-photo-heading">
                    <h2>{incident.title}</h2>
                    <p>{incident.district} · {incident.locationLabel}</p>
                  </div>
                )}
              </div>
              <figcaption className="p-4 text-xs leading-5 text-[var(--muted-text)]">
                <p>{item.caption}</p>
                <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block font-semibold text-[var(--body-text)] underline decoration-[var(--hairline)] underline-offset-4">{item.outlet}</a>
                <span> · {item.credit}</span>
              </figcaption>
            </figure>
          );
        })}
      </div>
    </section>
  );
}

type IncidentSignal = "death" | "injury" | "suspect-detained" | "suspect-wanted";


function KnifeIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} className={className} viewBox="0 0 256 256" fill="currentColor">
      {/* Phosphor Icons, MIT — bold knife glyph. */}
      <path d="M234.7 29.3a31.83 31.83 0 0 0-45 0L15.52 203.56a12 12 0 0 0 5.78 20.19A164.85 164.85 0 0 0 58.42 228c33.71 0 67.41-10.42 99.1-30.87 32.32-20.86 51.16-44.7 51.94-45.7a12 12 0 0 0-1-15.89L191 118l43.7-43.71a31.86 31.86 0 0 0 0-44.99ZM143.87 177.36C113 197.12 81.28 206 49.28 203.74L146 107l19.5 19.51 18 18a216.69 216.69 0 0 1-39.63 32.85Zm73.86-120L174 101l-11-11 43.7-43.72a7.8 7.8 0 0 1 11 11Z" />
    </svg>
  );
}

export function getIncidentType(incident: Pick<IncidentView, "title" | "category" | "summary" | "eventType">) {
  const labels: Record<string, string> = { "traffic-accident": "ДТП", assault: "Нападение", fight: "Драка", robbery: "Ограбление", accident: "Несчастный случай", fire: "Пожар", rescue: "Спасательная операция", "missing-person": "Пропавший человек", "transport-disruption": "Транспорт", weather: "Непогода", other: "Происшествие" };
  if (incident.eventType && labels[incident.eventType]) return labels[incident.eventType];
  const text = `${incident.title} ${incident.category} ${incident.summary}`.toLocaleLowerCase("ru-RU");

  if (/дтп|столкнов|авари/.test(text)) return "ДТП";
  if (/драк/.test(text)) return "Драка";
  if (/ограб|грабёж|грабеж|краж/.test(text)) return "Ограбление";
  if (/несчастн|падени|утонул|отравлен/.test(text)) return "Несчастный случай";
  if (/нападен|насиль|убийств|избил|побои/.test(text)) return "Нападение";

  return "Происшествие";
}

export function getIncidentSignals(incident: Pick<IncidentView, "title" | "status" | "summary" | "signals">): IncidentSignal[] {
  if (incident.signals) return incident.signals;
  const text = `${incident.title} ${incident.status} ${incident.summary}`.toLocaleLowerCase("ru-RU");
  const signals: IncidentSignal[] = [];

  if (/смерт|погиб|умер|убийств/.test(text)) signals.push("death");
  if (/разыскив/.test(text)) signals.push("suspect-wanted");
  else if (/задерж|под страж|арестован/.test(text)) signals.push("suspect-detained");

  return signals;
}

function IncidentTypeIcon({ type }: { type: string }) {
  const className = "size-3.5";

  if (type === "ДТП") return <CarFrontIcon aria-hidden="true" className={className} strokeWidth={2.1} />;
  if (type === "Драка") return <SwordsIcon aria-hidden="true" className={className} strokeWidth={2.1} />;
  if (type === "Ограбление") return <WalletCardsIcon aria-hidden="true" className={className} strokeWidth={2.1} />;
  if (type === "Несчастный случай") return <TriangleAlertIcon aria-hidden="true" className={className} strokeWidth={2.1} />;
  if (type === "Нападение") return <KnifeIcon aria-hidden="true" className={className} />;

  return <ShieldAlertIcon aria-hidden="true" className={className} strokeWidth={2.1} />;
}

function IncidentSignalIcon({ signal }: { signal: IncidentSignal }) {
  const className = "size-3.5";

  if (signal === "death") return <SkullIcon aria-hidden="true" className={className} strokeWidth={2.1} />;
  if (signal === "injury") return <CrossIcon aria-hidden="true" className={className} strokeWidth={2.1} />;
  if (signal === "suspect-detained") return <HandcuffsIcon aria-hidden="true" className={className} />;

  return <SearchIcon aria-hidden="true" className={className} strokeWidth={2.1} />;
}

function IncidentSignals({ incident }: { incident: Pick<IncidentView, "title" | "status" | "summary" | "signals"> }) {
  const signals = getIncidentSignals(incident);

  if (!signals.length) return null;

  return (
    <span className="incident-signals">
      {signals.map((signal) => {
        const details = {
          death: { label: "Есть погибшие" },
          injury: { label: "Есть пострадавшие" },
          "suspect-detained": { label: "Подозреваемый задержан" },
          "suspect-wanted": { label: "Подозреваемый разыскивается" },
        }[signal];

        return (
          <span key={signal} className={`incident-signal incident-signal--${signal}`} aria-label={details.label} title={details.label}>
            <IncidentSignalIcon signal={signal} />
          </span>
        );
      })}
    </span>
  );
}

function IncidentMeta({ incident }: { incident: Pick<IncidentView, "title" | "category" | "status" | "summary"> }) {
  const incidentType = getIncidentType(incident);

  return (
    <div className="incident-meta">
      <span className="incident-type" data-type={incidentType}>
        <IncidentTypeIcon type={incidentType} />
        {incidentType}
      </span>
      <IncidentSignals incident={incident} />
    </div>
  );
}

function IncidentLocation({ incident, placement }: { incident: IncidentView; placement: "timeline" | "sidebar" }) {
  return <section className={`incident-location incident-location--${placement} mobile-text-block rounded-2xl bg-[var(--card)] p-4`} aria-label="Локация происшествия">
    <h3 className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--subtle-text)]"><MapPinIcon size={16} aria-hidden="true" />Локация</h3>
    <p className="mt-2 font-semibold">{incident.locationLabel}</p>
    <p className="mt-1 text-sm leading-6 text-[var(--muted-text)]">{incident.locationPrecision}</p>
  </section>;
}

export function IncidentsView({ incidents }: { incidents: IncidentView[] }) {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>(PERIODS[2]);
  const [theme, setTheme] = useState<"day" | "night">("night");
  const visibleIncidents = useMemo(
    () => filterIncidents(incidents, period.hours),
    [incidents, period],
  );
  const [selectedSlug, setSelectedSlug] = useState(incidents[0]?.slug ?? "");
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [preselectedSlug, setPreselectedSlug] = useState(incidents[0]?.slug ?? "");
  const feedRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef(new Map<string, HTMLButtonElement>());
  const selected = selectVisibleIncident(visibleIncidents, selectedSlug);
  const activeMarkerSlug = mobileDetailOpen ? (selected?.slug ?? "") : preselectedSlug;

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("budapest-signal-theme");
    if (savedTheme === "day" || savedTheme === "night") setTheme(savedTheme);
  }, []);

  function changeTheme(nextTheme: "day" | "night") {
    setTheme(nextTheme);
    window.localStorage.setItem("budapest-signal-theme", nextTheme);
  }

  function openIncident(slug: string) {
    setSelectedSlug(slug);
    setPreselectedSlug(slug);
    setMobileDetailOpen(true);
  }

  function closeMobileDetail() {
    setMobileDetailOpen(false);
    setPreselectedSlug(selected?.slug ?? "");
  }

  function selectIncidentOnMap(slug: string) {
    setSelectedSlug(slug);
    setPreselectedSlug(slug);
    setMobileDetailOpen(false);

    window.requestAnimationFrame(() => {
      const card = cardRefs.current.get(slug);
      if (card && "scrollIntoView" in card) card.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }

  const updatePreselectedIncident = useCallback(() => {
    const feed = feedRef.current;
    if (!feed) return;

    const feedBounds = feed.getBoundingClientRect();
    let nearest: { slug: string; ratio: number } | undefined;

    for (const incident of visibleIncidents) {
      const card = cardRefs.current.get(incident.slug);
      if (!card) continue;

      const bounds = card.getBoundingClientRect();
      const visibleHeight = Math.max(0, Math.min(bounds.bottom, feedBounds.bottom) - Math.max(bounds.top, feedBounds.top));
      const ratio = visibleHeight / Math.max(1, bounds.height);

      if (ratio >= 0.5 && (!nearest || ratio > nearest.ratio)) {
        nearest = { slug: incident.slug, ratio };
      }
    }

    if (nearest) setPreselectedSlug(nearest.slug);
  }, [visibleIncidents]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(updatePreselectedIncident);
    return () => window.cancelAnimationFrame(frame);
  }, [updatePreselectedIncident]);

  return (
    <main className="signal-shell flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-[var(--app-bg)] text-[var(--app-text)] md:block md:h-auto md:min-h-screen md:overflow-visible" data-theme={theme} data-mobile-detail={mobileDetailOpen}>
      <header className="sticky top-0 z-20 shrink-0 border-b border-[var(--hairline)] bg-[var(--app-bg)]">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-5 px-5 py-3.5 lg:px-9">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-full border border-[var(--brand-border)] bg-[var(--brand)] font-mono text-xs font-bold text-[var(--brand-text)]">B</span>
            <div>
              <p className="text-base font-semibold tracking-[-0.03em]">Budapest Signal</p>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--muted-text)]">городская лента</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex rounded-full border border-[var(--hairline)] bg-[var(--control-bg)] p-0.5 text-[11px] font-semibold" aria-label="Язык">
              <span className="rounded-full bg-[var(--control-active)] px-2 py-1 text-[var(--control-active-text)]">RU</span>
              <span className="px-2 py-1 text-[var(--subtle-text)]">EN</span>
              <span className="px-2 py-1 text-[var(--subtle-text)]">HU</span>
            </div>
            <div className="flex rounded-full border border-[var(--hairline)] bg-[var(--control-bg)] p-0.5" aria-label="Тема карты и интерфейса">
              <button type="button" onClick={() => changeTheme("day")} aria-label="Дневной режим" aria-pressed={theme === "day"} className={`grid h-7 w-7 place-items-center rounded-full transition ${theme === "day" ? "bg-[var(--control-active)] text-[var(--control-active-text)]" : "text-[var(--subtle-text)] hover:text-[var(--app-text)]"}`}>
                <span aria-hidden="true">☼</span>
              </button>
              <button type="button" onClick={() => changeTheme("night")} aria-label="Ночной режим" aria-pressed={theme === "night"} className={`grid h-7 w-7 place-items-center rounded-full transition ${theme === "night" ? "bg-[var(--control-active)] text-[var(--control-active-text)]" : "text-[var(--subtle-text)] hover:text-[var(--app-text)]"}`}>
                <span aria-hidden="true">☾</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <section id="incidents" className="flex min-h-0 flex-1 flex-col overflow-hidden md:mx-auto md:block md:max-w-[1440px] md:overflow-visible md:px-5 md:py-6 lg:px-9 lg:py-8">
        <div className="mobile-incidents-workspace flex min-h-0 flex-1 flex-col md:grid md:gap-5 xl:grid-cols-[minmax(0,1.38fr)_360px]">
          <section className="map-frame relative basis-1/2 shrink-0 overflow-hidden border-y border-[var(--map-border)] bg-[var(--map-loading)] shadow-[var(--map-shadow)] md:min-h-[500px] md:rounded-[1.4rem] md:border xl:col-start-1 xl:row-start-1" aria-label="Карта инцидентов Будапешта" role="region">
            <IncidentMap theme={theme} incidents={visibleIncidents} selectedSlug={activeMarkerSlug} focusedSlug={mobileDetailOpen ? (selected?.slug ?? "") : ""} onSelect={selectIncidentOnMap} layoutMode={mobileDetailOpen ? "detail" : "list"} />
            <div className="map-controls absolute left-4 top-4 z-[1100] flex w-fit rounded-full border border-[var(--map-overlay-border)] bg-[var(--map-overlay)] p-1 shadow-sm backdrop-blur-md" aria-label="Период событий">
              {PERIODS.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => setPeriod(item)}
                  aria-pressed={period.label === item.label}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${period.label === item.label ? "bg-[var(--control-active)] text-[var(--control-active-text)]" : "text-[var(--map-overlay-text)] hover:text-[var(--app-text)]"}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <span className="map-counter absolute right-4 top-4 z-[1100] grid size-11 place-items-center rounded-full border border-[var(--map-overlay-border)] bg-[var(--map-overlay)] font-mono text-sm font-semibold tabular-nums text-[var(--map-overlay-text)] shadow-sm backdrop-blur-md" aria-label={`Всего ${visibleIncidents.length} происшествий на карте`}>
              {visibleIncidents.length}
            </span>
            <button type="button" onClick={closeMobileDetail} className="mobile-map-back absolute left-4 top-4 z-[1100] size-11 place-items-center rounded-full border border-[var(--map-overlay-border)] bg-[var(--map-overlay)] text-[var(--map-overlay-text)] shadow-sm backdrop-blur-md" aria-label="Назад к списку происшествий">
              <ArrowLeftIcon aria-hidden="true" className="size-5" strokeWidth={2.2} />
            </button>
            {mobileDetailOpen && selected && (
              <div className="mobile-map-summary absolute inset-x-4 bottom-4 z-[1100]">
                <p className="mobile-map-summary-title text-sm font-semibold leading-5 text-[var(--map-overlay-text)]">{selected.title}</p>
                <p className="mobile-map-summary-address mt-1 text-xs leading-4 text-[var(--map-overlay-text)]/75">{selected.district} · {selected.locationLabel}</p>
              </div>
            )}
          </section>

          <div ref={feedRef} onScroll={updatePreselectedIncident} className="mobile-incident-feed min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 md:contents" data-testid="incident-feed">
            <aside className="mobile-incident-list space-y-3 xl:col-start-2 xl:row-start-1" aria-label="Лента происшествий">
              {visibleIncidents.length ? (
                visibleIncidents.map((incident) => (
                  <button
                    key={incident.slug}
                    ref={(element) => {
                      if (element) cardRefs.current.set(incident.slug, element);
                      else cardRefs.current.delete(incident.slug);
                    }}
                    type="button"
                    onClick={() => openIncident(incident.slug)}
                    data-selected={incident.slug === activeMarkerSlug}
                    className="incident-list-card w-full p-4 text-left transition"
                  >
                    <div className="mb-3 flex items-center justify-between gap-3 text-xs font-medium">
                      <IncidentMeta incident={incident} />
                      <span className="text-[var(--subtle-text)]">{formatDate(incident.occurredAt)}</span>
                    </div>
                    <h2 className="text-base font-semibold leading-5 tracking-[-0.02em]">{incident.title}</h2>
                    <p className="mt-2 text-sm text-[var(--muted-text)]">{incident.district} · {incident.locationLabel}</p>
                  </button>
                ))
              ) : (
                <div className="rounded-2xl bg-[var(--card)] p-6 text-sm text-[var(--muted-text)]">За этот период нет внесённых происшествий.</div>
              )}
            </aside>

            {selected && (
              <section className="mobile-incident-detail mt-5 grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)] xl:col-span-2 xl:row-start-2" data-has-media={selected.media.length > 0} aria-live="polite">
            <div className="mobile-detail-content">
              <div className="incident-story-intro">
              <div className="mobile-detail-tags flex flex-col items-start gap-2 text-xs font-bold">
                <IncidentMeta incident={selected} />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-[var(--status-bg)] px-2.5 py-1 text-[var(--status-text)]">{selected.status}</span>
                  <span className="rounded-full bg-[var(--tag-bg)] px-2.5 py-1 text-[var(--tag-text)]">{selected.verification}</span>
                </div>
              </div>
              <h2 className="mobile-detail-title mt-3 text-2xl font-semibold tracking-[-0.04em]">{selected.title}</h2>
              <p className="mobile-detail-location mt-2 text-sm font-medium text-[var(--muted-text)]">{selected.district} · {selected.locationLabel}</p>
              <p className="mt-5 max-w-3xl leading-7 text-[var(--body-text)]">{selected.summary}</p>
              <ContextClaims claims={(selected.context ?? []).filter((claim) => claim.subject.kind === "event")} title="Обстоятельства и версии" />
              </div>

              <IncidentMediaGallery incident={selected} />

              <div className="incident-timeline mt-6 pt-2">
                <h3 className="font-semibold">Хронология</h3>
                <ol className="mt-3 space-y-4 pl-4">
                  {selected.updates.map((update) => (
                    <li key={update.id} className="relative">
                      <span className="absolute -left-4 top-1.5 h-2 w-2 rounded-full bg-[var(--accent-text)]" />
                      <div className="flex flex-wrap items-center gap-2">
                        {isOfficialInformation(update.verification) ? (
                          <p className="text-xs font-medium text-[var(--subtle-text)]">{formatDate(update.publishedAt)} · {update.verification}</p>
                        ) : (
                          <>
                            <p className="text-xs font-medium text-[var(--subtle-text)]">{formatDate(update.publishedAt)}</p>
                            <span className="rounded-full bg-[var(--status-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--status-text)]">{update.verification}</span>
                          </>
                        )}
                        <IncidentSignals incident={{ title: update.title, status: "", summary: update.detail }} />
                      </div>
                      <p className="mt-1 font-semibold">{update.title}</p>
                      <p className="mt-1 text-sm leading-6 text-[var(--muted-text)]">{update.detail}</p>
                    </li>
                  ))}
                </ol>
                <IncidentLocation incident={selected} placement="timeline" />
              </div>
            </div>

            <div className="mobile-text-stack space-y-6">
              <IncidentParticipants participants={selected.participants ?? []} context={selected.context ?? []} legal={selected.legal} />
              <IncidentLocation incident={selected} placement="sidebar" />
              <div className="pt-2">
                <h3 className="font-semibold">Источники</h3>
                <div className="mt-3 space-y-3">
                  {selected.sources.map((source) => {
                    const official = isOfficialInformation(source.sourceType);

                    return (
                      <a key={source.id} href={source.sourceUrl} target="_blank" rel="noreferrer" className="mobile-text-block block rounded-2xl bg-[var(--card)] p-4 transition hover:bg-[var(--card-hover)]">
                        <p className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${official ? "bg-[var(--tag-bg)] text-[var(--tag-text)]" : "bg-[var(--status-bg)] text-[var(--status-text)]"}`}>{source.sourceType}</p>
                        <p className="mt-2 font-semibold">{source.outlet}</p>
                        <p className="mt-1 text-sm leading-6 text-[var(--muted-text)]">{source.note}</p>
                      </a>
                    );
                  })}
                </div>
              </div>
            </div>
              </section>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
