"use client";

import dynamic from "next/dynamic";
import { LocaleProvider, useI18n } from "./i18n";
import { dateLocales, localeNames, translateContent, type Locale } from "./locale";
import { useCallback, useEffect, useMemo, useRef, useState, type SVGProps } from "react";
import { ArrowLeftIcon, BellRingIcon, CarFrontIcon, CrossIcon, LocateFixedIcon, MapPinIcon, SearchIcon, ShieldAlertIcon, SkullIcon, SwordsIcon, TriangleAlertIcon, WalletCardsIcon } from "lucide-react";
import { filterIncidents, matchesSeverity, PERIODS, SEVERITIES, type Severity, selectVisibleIncident } from "./incidents-model";
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
    loading: () => <MapLoading /> /* localized loading */ ,
  },
);
function MapLoading() { const {t}=useI18n(); return <div className="grid h-full w-full place-items-center bg-[var(--map-loading)] text-sm font-medium text-[var(--muted-text)]">{t("Загрузка карты…")}</div>; }

export type IncidentView = {
  translations?: Partial<Record<"en" | "hu", Record<string, string>>>;
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
    signals?: IncidentSignal[];
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

function formatDate(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(dateLocales[locale], {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Budapest",
  }).format(new Date(value));
}

function isOfficialInformation(label: string) {
  return !/неофициаль|unofficial|nem hivatalos/i.test(label) && /официаль|official|hivatalos|police|brfk/i.test(label);
}

function IncidentMediaGallery({ incident }: { incident: IncidentView }) {
  const {t}=useI18n();
  const { media } = incident;
  const [revealedIds, setRevealedIds] = useState<number[]>([]);

  if (!media.length) return null;

  return (
    <section className="incident-media-gallery mt-6" aria-label={t('Фотографии с места')}>
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
                    aria-label={t('Показать чувствительное изображение')}
                    className="absolute inset-0 grid place-items-center bg-black/25 p-5 text-center text-sm font-semibold text-white"
                  >
                    <span className="rounded-full bg-black/65 px-4 py-2.5">{t('Чувствительное изображение · показать')}</span>
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

  if (/пропавш|пропал|исчезновен/.test(incident.category.toLowerCase())) return "Пропавший человек";
  if (/дтп|столкнов|авари/.test(text)) return "ДТП";
  if (/драк/.test(text)) return "Драка";
  if (/ограб|грабёж|грабеж|краж/.test(text)) return "Ограбление";
  if (/несчастн|падени|утонул|отравлен/.test(text)) return "Несчастный случай";
  if (/нападен|насиль|убийств|избил|побои/.test(text)) return "Нападение";

  return "Происшествие";
}

export function getIncidentSignals(incident: Pick<IncidentView, "title" | "status" | "summary" | "signals" | "eventType">): IncidentSignal[] {
  if (incident.signals) return incident.eventType==='missing-person'?incident.signals.filter(s=>s==='death'||s==='injury'):incident.signals;
  const text = `${incident.title} ${incident.status} ${incident.summary}`.toLocaleLowerCase("ru-RU");
  const signals: IncidentSignal[] = [];

  if (/смерт|погиб|умер|убийств/.test(text)) signals.push("death");
  if (incident.eventType!=='missing-person') {
    if (/разыскив/.test(text)) signals.push("suspect-wanted");
    else if (/задерж|под страж|арестован/.test(text)) signals.push("suspect-detained");
  }

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
  const {t}=useI18n();
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
          <span key={signal} className={`incident-signal incident-signal--${signal}`} aria-label={t(details.label)} title={t(details.label)}>
            <IncidentSignalIcon signal={signal} />
          </span>
        );
      })}
    </span>
  );
}

function IncidentMeta({ incident, compact = false }: { incident: Pick<IncidentView, "title" | "category" | "status" | "summary" | "signals" | "eventType">; compact?: boolean }) {
  const {t}=useI18n();
  const incidentType = getIncidentType(incident);

  return (
    <div className="incident-meta">
      <span className="incident-type" data-type={incidentType}>
        <IncidentTypeIcon type={incidentType} />
        {t(incidentType)}
      </span>
      <IncidentSignals incident={compact ? {...incident, signals:getIncidentSignals(incident).filter(signal=>signal==="death")} : incident} />
    </div>
  );
}

function IncidentLocation({ incident, placement }: { incident: IncidentView; placement: "timeline" | "sidebar" }) {
  const {t}=useI18n();
  return <section className={`incident-location incident-location--${placement} mobile-text-block rounded-2xl bg-[var(--card)] p-4`} aria-label={t('Локация происшествия')}>
    <h3 className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--subtle-text)]"><MapPinIcon size={16} aria-hidden="true" />{t('Локация')}</h3>
    <p className="mt-2 font-semibold">{incident.locationLabel}</p>
    <p className="mt-1 text-sm leading-6 text-[var(--muted-text)]">{incident.locationPrecision}</p>
  </section>;
}

export function IncidentsView(props: { incidents: IncidentView[] }) {
  return <LocaleProvider><LocalizedIncidentsView {...props} /></LocaleProvider>;
}
function LocalizedIncidentsView({ incidents }: { incidents: IncidentView[] }) {
  const {locale,setLocale,t}=useI18n();
  const typedIncidents = useMemo(()=>incidents.map(incident=>({...incident, eventType:incident.eventType ?? ({"ДТП":"traffic-accident","Нападение":"assault","Драка":"fight","Ограбление":"robbery","Несчастный случай":"accident","Пропавший человек":"missing-person"}[getIncidentType(incident)] ?? "other"), signals:getIncidentSignals(incident),updates:incident.updates.map(update=>({...update,signals:getIncidentSignals({title:update.title,status:"",summary:update.detail,eventType:incident.eventType})}))})),[incidents]);
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>(PERIODS[3]);
  const [severity, setSeverity] = useState<Severity>("all");
  const [theme, setTheme] = useState<"day" | "night">("night");
  const visibleIncidents = useMemo(
    () => filterIncidents(typedIncidents.filter(incident=>incident.eventType!=="missing-person" && matchesSeverity(incident,severity)), period.hours).map(incident=>translateContent(incident,locale,locale==="ru"?{}:incident.translations?.[locale])),
    [typedIncidents, period, severity, locale],
  );
  const [selectedSlug, setSelectedSlug] = useState(incidents[0]?.slug ?? "");
  const [hoveredSlug, setHoveredSlug] = useState("");
  const [desktop, setDesktop] = useState(false);
  const listRef = useRef<HTMLElement>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [preselectedSlug, setPreselectedSlug] = useState(incidents[0]?.slug ?? "");
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number }>();
  const [locationState, setLocationState] = useState<"idle" | "locating" | "ready" | "error">("idle");
  const [pushState, setPushState] = useState<"idle" | "subscribing" | "enabled" | "install-required" | "unsupported" | "error">("idle");
  const feedRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef(new Map<string, HTMLButtonElement>());
  const mapSelectionFrameRef = useRef<number | null>(null);
  const selected = selectVisibleIncident(visibleIncidents, selectedSlug);
  const activeMarkerSlug = desktop || mobileDetailOpen ? (selected?.slug ?? "") : preselectedSlug;

  useEffect(() => {
    const feed = feedRef.current, list = listRef.current;
    const last = cardRefs.current.get(visibleIncidents.at(-1)?.slug ?? "");
    if (!feed || !list || !last || mobileDetailOpen) return;
    // End the mobile scroll with the last card directly below the map. Measure
    // its real height because titles, translations and the viewport can change.
    const measure = () => {
      const bottom = parseFloat(getComputedStyle(feed).paddingBottom) || 0;
      const space = Math.max(0, feed.clientHeight - last.getBoundingClientRect().height - bottom);
      list.style.setProperty("--mobile-list-end-space", `${space}px`);
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => { window.removeEventListener("resize", measure); list.style.removeProperty("--mobile-list-end-space"); };
    }
    const observer = new ResizeObserver(measure);
    observer.observe(feed); observer.observe(last);
    return () => { observer.disconnect(); list.style.removeProperty("--mobile-list-end-space"); };
  }, [visibleIncidents, mobileDetailOpen]);

  useEffect(() => {
    // This is the actual two-column breakpoint. Below it, the map and feed
    // use the compact one-column interaction model rather than a squeezed
    // desktop map with a separate list.
    const query = window.matchMedia("(min-width: 1280px)");
    const update = () => { setDesktop(query.matches); setHoveredSlug(""); };
    update(); query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.getRegistration("/push-worker.js")
      .then(registration => registration?.pushManager.getSubscription())
      .then(subscription => { if (subscription) setPushState("enabled"); })
      .catch(() => undefined);
  }, []);

  function hoverMapIncident(slug: string | null) {
    if (!desktop || !window.matchMedia("(hover: hover)").matches) return;
    setHoveredSlug(slug ?? "");
    const card = slug ? cardRefs.current.get(slug) : null;
    const list = listRef.current;
    if (!card || !list) return;
    const cardBounds = card.getBoundingClientRect(), bounds = list.getBoundingClientRect();
    // Scroll only the card list, never the page, map or selected article.
    const top = list.scrollTop + cardBounds.top - bounds.top - (list.clientHeight - cardBounds.height) / 2;
    list.scrollTo({ top: Math.max(0, top), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }

  useEffect(() => {
    workspaceRef.current?.style.setProperty("--mobile-detail-scroll", "0px");
    if (mobileDetailOpen && feedRef.current) feedRef.current.scrollTop = 0;
  }, [mobileDetailOpen, selected?.slug]);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("budapest-signal-theme");
    if (savedTheme === "day" || savedTheme === "night") setTheme(savedTheme);
  }, []);

  useEffect(() => () => {
    if (mapSelectionFrameRef.current !== null) window.cancelAnimationFrame(mapSelectionFrameRef.current);
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

  function locateUser() {
    if (!navigator.geolocation) { setLocationState("error"); return; }
    setLocationState("locating");
    navigator.geolocation.getCurrentPosition(
      position => {
        setUserLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude });
        setLocationState("ready");
      },
      () => setLocationState("error"),
      { enableHighAccuracy: false, maximumAge: 300_000, timeout: 10_000 },
    );
  }

  function vapidKey(value: string) {
    const padding = "=".repeat((4 - value.length % 4) % 4);
    const raw = window.atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(raw, character => character.charCodeAt(0));
  }

  async function enablePushNotifications() {
    const iosBrowser = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (iosBrowser && !standalone) { setPushState("install-required"); return; }
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) { setPushState("unsupported"); return; }
    setPushState("subscribing");
    try {
      const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      if (permission !== "granted") throw new Error("permission");
      const registration = await navigator.serviceWorker.register("/push-worker.js", { scope: "/" });
      const config = await fetch("/api/push/config", { cache: "no-store" });
      if (!config.ok) throw new Error("configuration");
      const { enabled, publicKey } = await config.json() as { enabled: boolean; publicKey?: string };
      if (!enabled || !publicKey) throw new Error("configuration");
      const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKey(publicKey) });
      const response = await fetch("/api/push/subscriptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...subscription.toJSON(), locale }) });
      if (!response.ok) throw new Error("subscription");
      setPushState("enabled");
    } catch { setPushState("error"); }
  }

  function selectIncidentOnMap(slug: string) {
    setSelectedSlug(slug);
    setPreselectedSlug(slug);
    setMobileDetailOpen(false);

    if (mapSelectionFrameRef.current !== null) window.cancelAnimationFrame(mapSelectionFrameRef.current);
    mapSelectionFrameRef.current = window.requestAnimationFrame(() => {
      mapSelectionFrameRef.current = null;
      const card = cardRefs.current.get(slug);
      const feed = feedRef.current;
      if (!card || !feed) return;
      // scrollIntoView also moves the page and can race a second marker click.
      // Keep the selected card just below the map, within the feed itself.
      const cardBounds = card.getBoundingClientRect();
      const feedBounds = feed.getBoundingClientRect();
      const target = feed.scrollTop + cardBounds.top - feedBounds.top - 16;
      const max = Math.max(0, feed.scrollHeight - feed.clientHeight);
      feed.scrollTo({ top: Math.max(0, Math.min(max, target)), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
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

  function updateFeedScroll() {
    if (mobileDetailOpen) {
      // Keep scroll-linked sizing outside React so the map does not rerender
      // on every gesture. CSS limits the collapse to 8% of the viewport.
      workspaceRef.current?.style.setProperty("--mobile-detail-scroll", `${Math.max(0, feedRef.current?.scrollTop ?? 0)}px`);
    } else updatePreselectedIncident();
  }

  return (
    <main className="signal-shell flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-[var(--app-bg)] text-[var(--app-text)] xl:block xl:h-auto xl:min-h-screen xl:overflow-visible" data-theme={theme} data-mobile-detail={mobileDetailOpen}>
      <header className="sticky top-0 z-20 shrink-0 border-b border-[var(--hairline)] bg-[var(--app-bg)]">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-5 px-5 py-3.5 lg:px-9">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-full border border-[var(--brand-border)] bg-[var(--brand)] font-mono text-xs font-bold text-[var(--brand-text)]">C</span>
            <div>
              <p className="text-base font-semibold tracking-[-0.03em]">Crime Map</p>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--muted-text)]">{t('городская лента')}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={enablePushNotifications}
              disabled={pushState === "subscribing" || pushState === "enabled"}
              aria-pressed={pushState === "enabled"}
              aria-label={t(pushState === "enabled" ? "Уведомления о новых событиях включены" : pushState === "subscribing" ? "Включаем уведомления" : "Включить уведомления о новых событиях")}
              title={t(pushState === "enabled" ? "Уведомления о новых событиях включены" : "Включить уведомления о новых событиях")}
              className={`grid h-8 w-8 place-items-center rounded-full border border-[var(--hairline)] bg-[var(--control-bg)] transition hover:text-[var(--app-text)] disabled:cursor-default ${pushState === "enabled" ? "text-[var(--success-text)]" : "text-[var(--subtle-text)]"}`}
            >
              <BellRingIcon aria-hidden="true" className={pushState === "subscribing" ? "size-4 animate-pulse" : "size-4"} strokeWidth={2.1} />
            </button>
            <div className="flex rounded-full border border-[var(--hairline)] bg-[var(--control-bg)] p-0.5 text-[11px] font-semibold" aria-label={t('Язык')}>
{(["ru","en","hu"] as const).map(language=><button type="button" key={language} onClick={()=>setLocale(language)} aria-label={localeNames[language]} aria-pressed={locale===language} className={`rounded-full px-2 py-1 ${locale===language?"bg-[var(--control-active)] text-[var(--control-active-text)]":"text-[var(--subtle-text)]"}`}>{language.toUpperCase()}</button>)}
            </div>
            <div className="flex rounded-full border border-[var(--hairline)] bg-[var(--control-bg)] p-0.5" aria-label={t('Тема карты и интерфейса')}>
              <button type="button" onClick={() => changeTheme("day")} aria-label={t('Дневной режим')} aria-pressed={theme === "day"} className={`grid h-7 w-7 place-items-center rounded-full transition ${theme === "day" ? "bg-[var(--control-active)] text-[var(--control-active-text)]" : "text-[var(--subtle-text)] hover:text-[var(--app-text)]"}`}>
                <span aria-hidden="true">☼</span>
              </button>
              <button type="button" onClick={() => changeTheme("night")} aria-label={t('Ночной режим')} aria-pressed={theme === "night"} className={`grid h-7 w-7 place-items-center rounded-full transition ${theme === "night" ? "bg-[var(--control-active)] text-[var(--control-active-text)]" : "text-[var(--subtle-text)] hover:text-[var(--app-text)]"}`}>
                <span aria-hidden="true">☾</span>
              </button>
            </div>
          </div>
        </div>
      </header>
      {(pushState === "install-required" || pushState === "unsupported" || pushState === "error") && <p role="status" className="absolute right-5 top-[4.5rem] z-30 max-w-72 rounded-xl border border-[var(--hairline)] bg-[var(--card)] px-3 py-2 text-xs leading-5 text-[var(--muted-text)] shadow-lg">{t(pushState === "install-required" ? "На iPhone добавьте Crime Map на экран «Домой», откройте его с иконки и включите уведомления." : pushState === "unsupported" ? "Уведомления недоступны в этом браузере" : "Не удалось включить уведомления")}</p>}

      <section id="incidents" className="flex min-h-0 flex-1 flex-col overflow-hidden xl:mx-auto xl:block xl:max-w-[1440px] xl:overflow-visible xl:px-9 xl:py-8">
        <div ref={workspaceRef} className="mobile-incidents-workspace flex min-h-0 flex-1 flex-col xl:grid xl:gap-5 xl:grid-cols-[minmax(0,1.38fr)_360px]">
          <section className="map-frame relative basis-1/2 shrink-0 overflow-hidden border-y border-[var(--map-border)] bg-[var(--map-loading)] shadow-[var(--map-shadow)] xl:min-h-[475px] xl:rounded-[1.4rem] xl:border xl:col-start-1 xl:row-start-1" aria-label={t("Карта инцидентов Будапешта")} role="region">
            <IncidentMap theme={theme} incidents={visibleIncidents} selectedSlug={activeMarkerSlug} hoveredSlug={desktop ? hoveredSlug : ""} onHover={hoverMapIncident} focusedSlug={mobileDetailOpen ? (selected?.slug ?? "") : ""} onSelect={selectIncidentOnMap} layoutMode={mobileDetailOpen ? "detail" : "list"} userLocation={userLocation} />
            <div className="map-filter-stack">
            <div className="map-controls flex w-fit rounded-full border border-[var(--map-overlay-border)] bg-[var(--map-overlay)] p-1 shadow-sm backdrop-blur-md" role="group" aria-label={t('Период событий')}>
              {PERIODS.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => { setPeriod(item); setMobileDetailOpen(false); setHoveredSlug(""); }}
                  aria-pressed={period.label === item.label}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${period.label === item.label ? "bg-[var(--control-active)] text-[var(--control-active-text)]" : "text-[var(--map-overlay-text)] hover:text-[var(--app-text)]"}`}
                >
                  {t(item.label)}
                </button>
              ))}
            </div>
            <div className="map-controls map-severity-controls flex w-fit rounded-full border border-[var(--map-overlay-border)] bg-[var(--map-overlay)] p-1 shadow-sm backdrop-blur-md" role="group" aria-label={t('Тяжесть происшествий')}>
              {SEVERITIES.map(item=><button key={item.value} type="button" aria-pressed={severity===item.value} onClick={()=>{setSeverity(item.value);setMobileDetailOpen(false);setHoveredSlug("");}} className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${severity===item.value?"bg-[var(--control-active)] text-[var(--control-active-text)]":"text-[var(--map-overlay-text)] hover:text-[var(--app-text)]"}`}>{t(item.label)}</button>)}
            </div>
            </div>
            <span className="map-counter absolute right-4 top-4 z-[1100] grid size-11 place-items-center rounded-full border border-[var(--map-overlay-border)] bg-[var(--map-overlay)] font-mono text-sm font-semibold tabular-nums text-[var(--accent-text)] shadow-sm backdrop-blur-md" aria-label={t("Всего {n} происшествий на карте",{n:visibleIncidents.length})}>
              {visibleIncidents.length}
            </span>
            <button type="button" onClick={closeMobileDetail} className="mobile-map-back absolute left-4 top-4 z-[1100] size-11 place-items-center rounded-full border border-[var(--map-overlay-border)] bg-[var(--map-overlay)] text-[var(--map-overlay-text)] shadow-sm backdrop-blur-md" aria-label={t('Назад к списку происшествий')}>
              <ArrowLeftIcon aria-hidden="true" className="size-5" strokeWidth={2.2} />
            </button>
            {!mobileDetailOpen && <>
              <button type="button" onClick={locateUser} disabled={locationState === "locating"} aria-pressed={locationState === "ready"} aria-label={t(locationState === "locating" ? "Определяем местоположение" : "Показать моё местоположение")} title={t("Показать моё местоположение")} className="map-geolocation absolute bottom-4 right-4 z-[1100] grid size-11 place-items-center rounded-full border border-[var(--map-overlay-border)] bg-[var(--map-overlay)] text-[var(--map-overlay-text)] shadow-sm backdrop-blur-md transition hover:scale-105 disabled:cursor-wait disabled:opacity-70">
                <LocateFixedIcon aria-hidden="true" className={locationState === "locating" ? "size-5 animate-pulse" : "size-5"} strokeWidth={2.1} />
              </button>
              {locationState === "error" && <p role="status" className="absolute bottom-16 right-4 z-[1100] max-w-52 rounded-xl border border-[var(--map-overlay-border)] bg-[var(--map-overlay)] px-3 py-2 text-xs leading-4 text-[var(--map-overlay-text)] shadow-sm backdrop-blur-md">{t("Не удалось определить местоположение")}</p>}
            </>}
            {mobileDetailOpen && selected && (
              <div className="mobile-map-summary absolute inset-x-4 bottom-4 z-[1100]">
                <p className="mobile-map-summary-title text-sm font-semibold leading-5 text-[var(--map-overlay-text)]">{selected.title}</p>
                <p className="mobile-map-summary-address mt-1 text-xs leading-4 text-[var(--map-overlay-text)]/75">{selected.district} · {selected.locationLabel}</p>
              </div>
            )}
          </section>

          <div ref={feedRef} onScroll={updateFeedScroll} className="mobile-incident-feed min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 xl:contents" data-testid="incident-feed">
            <aside ref={listRef} className="mobile-incident-list space-y-3 xl:col-start-2 xl:row-start-1" aria-label={t("Лента происшествий")}>
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
                    onMouseEnter={() => { if (desktop) setHoveredSlug(incident.slug); }}
                    onMouseLeave={() => setHoveredSlug("")}
                    onFocus={() => { if (desktop) setHoveredSlug(incident.slug); }}
                    onBlur={() => setHoveredSlug("")}
                    data-hovered={desktop && incident.slug === hoveredSlug}
                    data-selected={incident.slug === activeMarkerSlug}
                    className="incident-list-card w-full p-4 text-left transition"
                  >
                    <div className="mb-3 flex items-center justify-between gap-3 text-xs font-medium">
                      <IncidentMeta incident={incident} compact />
                      <span className="text-[var(--subtle-text)]">{formatDate(incident.occurredAt,locale)}</span>
                    </div>
                    <h2 className="text-base font-semibold leading-5 tracking-[-0.02em]">{incident.title}</h2>
                    <p className="mt-2 text-sm text-[var(--muted-text)]">{incident.district} · {incident.locationLabel}</p>
                  </button>
                ))
              ) : (
                <div className="rounded-2xl bg-[var(--card)] p-6 text-sm text-[var(--muted-text)]">{t(severity==="all"?"За этот период нет внесённых происшествий.":"Нет происшествий с выбранными фильтрами.")}</div>
              )}
            </aside>

            {selected && (
              <section className="mobile-incident-detail mt-5 grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)] xl:col-span-2 xl:row-start-2" data-has-media={selected.media.length > 0} aria-live="polite">
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
              <ContextClaims claims={(selected.context ?? []).filter((claim) => claim.subject.kind === "event")} title={t("Обстоятельства и версии")} />
              </div>

              <IncidentMediaGallery incident={selected} />

              <div className="incident-timeline mt-6 pt-2">
                <h3 className="font-semibold">{t('Хронология')}</h3>
                <ol className="mt-3 space-y-4 pl-4">
                  {selected.updates.map((update) => (
                    <li key={update.id} className="relative">
                      <span className="absolute -left-4 top-1.5 h-2 w-2 rounded-full bg-[var(--accent-text)]" />
                      <div className="flex flex-wrap items-center gap-2">
                        {isOfficialInformation(update.verification) ? (
                          <p className="text-xs font-medium text-[var(--subtle-text)]">{formatDate(update.publishedAt,locale)} · {update.verification}</p>
                        ) : (
                          <>
                            <p className="text-xs font-medium text-[var(--subtle-text)]">{formatDate(update.publishedAt,locale)}</p>
                            <span className="rounded-full bg-[var(--status-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--status-text)]">{update.verification}</span>
                          </>
                        )}
                        <IncidentSignals incident={{ title: update.title, status: "", summary: update.detail, signals:update.signals }} />
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
                <h3 className="font-semibold">{t('Источники')}</h3>
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
