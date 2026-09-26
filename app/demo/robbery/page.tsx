import { IncidentsView, type IncidentView } from "../../incidents-view";

const demo: IncidentView = {
  id: -100, slug: "demo-robbery-wanted", title: "ТЕСТ · Ограбление магазина",
  category: "Ограбление", status: "Участник разыскивается", verification: "Вымышленное событие",
  district: "Будапешт · демонстрация", locationLabel: "Условная точка на карте",
  locationPrecision: "Место выбрано только для демонстрации интерфейса; реального происшествия здесь не заявлено.",
  latitude: 47.4979, longitude: 19.0402,
  occurredAt: "2026-09-24T18:00:00+02:00", updatedAt: "2026-09-24T20:00:00+02:00",
  summary: "Тестовый сценарий: после вымышленного ограбления магазина один участник разыскивается, второй задержан. Все сведения придуманы для проверки цветов, статусов и ориентировки.",
  media: [], sources: [{ id: -101, sourceType: "Тестовые данные", outlet: "Демонстрационный макет", sourceUrl: "/demo/robbery", publishedAt: "2026-09-24T20:00:00+02:00", note: "Вымышленный сценарий. Не сообщение полиции и не реальное происшествие." }],
  updates: [{ id: -101, publishedAt: "2026-09-24T18:30:00+02:00", title: "ТЕСТ · Один участник разыскивается", detail: "Добавлен пример ориентировки. Второй участник задержан в рамках вымышленного сценария.", verification: "Демонстрация" }],
  participants: [
    { key: "demo-wanted", role: "suspect", label: "Неустановленный участник", status: "wanted", profile: { kind: "person" }, note: "Тестовые сведения: личность и возраст неизвестны. Силуэт условный и не является изображением реального человека.", sourceUrl: "/demo/robbery", sourceLabel: "Тестовый макет", asOf: "2026-09-24T20:00:00+02:00",
      wantedNotice: { isDemo: true, description: "Пример описания: тёмная куртка с капюшоном, светлый рюкзак. Здесь могут быть опубликованные источником приметы, одежда и обстоятельства последнего наблюдения. Все приметы в этом примере вымышлены." } },
    { key: "demo-detained", role: "suspect", label: "Тестовый участник", status: "detained", profile: { kind: "person", gender: "male", age: 34 }, note: "Вымышленный участник для сравнения: обычный зелёный статус задержания без пульсации.", sourceUrl: "/demo/robbery", sourceLabel: "Тестовый макет", asOf: "2026-09-24T20:00:00+02:00" },
  ],
};

export default function RobberyDemo() {
  return <IncidentsView incidents={[demo]} />;
}
