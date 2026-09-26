"use client";

import L from "leaflet";
import { useI18n } from "./i18n";
import { useEffect } from "react";
import { MapContainer, Marker, TileLayer, Tooltip, useMap } from "react-leaflet";

export type MapIncident = {
  slug: string;
  title: string;
  latitude: number;
  longitude: number;
};

function FitVisibleIncidents({ incidents, focusedSlug, layoutMode }: { incidents: MapIncident[]; focusedSlug: string; layoutMode: "list" | "detail" }) {
  const map = useMap();

  useEffect(() => {
    map.invalidateSize({ animate: false });

    const focusedIncident = incidents.find((incident) => incident.slug === focusedSlug);
    if (focusedIncident) {
      map.flyTo([focusedIncident.latitude, focusedIncident.longitude], 16, { animate: true, duration: 0.55 });
      return;
    }

    if (incidents.length === 0) return;

    if (incidents.length === 1) {
      map.setView([incidents[0].latitude, incidents[0].longitude], 15);
      return;
    }

    map.fitBounds(
      L.latLngBounds(incidents.map((incident) => [incident.latitude, incident.longitude])),
      { padding: [56, 56], maxZoom: 14 },
    );
  }, [focusedSlug, incidents, layoutMode, map]);

  return null;
}

function KeepMapSized() {
  const map = useMap();

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;

    const container = map.getContainer();
    const observer = new ResizeObserver(() => map.invalidateSize({ animate: false }));

    observer.observe(container);
    return () => observer.disconnect();
  }, [map]);

  return null;
}

function incidentIcon(active: boolean, isNight: boolean) {
  const mode = isNight ? "is-night" : "is-day";
  const state = active ? "is-active" : "";

  return L.divIcon({
    className: `signal-marker-icon ${mode} ${state}`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    html: '<span class="signal-marker-anchor"><span class="signal-marker-halo"></span><span class="signal-marker-core"></span></span>',
  });
}

export function IncidentMap({
  incidents,
  selectedSlug,
  focusedSlug,
  onSelect,
  theme,
  layoutMode,
}: {
  incidents: MapIncident[];
  selectedSlug: string;
  focusedSlug: string;
  onSelect: (slug: string) => void;
  theme: "day" | "night";
  layoutMode: "list" | "detail";
}) {
  const {t}=useI18n();
  const isNight = theme === "night";

  return (
    <div className={`signal-map-theme signal-map-theme--${theme} h-full w-full`}>
      <MapContainer
        center={[47.481, 19.071]}
        zoom={13}
        minZoom={11}
        scrollWheelZoom
        zoomControl={false}
        attributionControl={false}
        className="signal-map h-full w-full"
        aria-label={t('Интерактивная карта Будапешта')}
      >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        subdomains="abc"
      />
      <FitVisibleIncidents incidents={incidents} focusedSlug={focusedSlug} layoutMode={layoutMode} />
      <KeepMapSized />
      {incidents.map((incident) => {
        const active = incident.slug === selectedSlug;
        return (
          <Marker
            key={incident.slug}
            position={[incident.latitude, incident.longitude]}
            icon={incidentIcon(active, isNight)}
            eventHandlers={{ click: () => onSelect(incident.slug) }}
          >
            <Tooltip direction="top" offset={[0, -18]} opacity={1}>
              {incident.title}
            </Tooltip>
          </Marker>
        );
      })}
      </MapContainer>
    </div>
  );
}
