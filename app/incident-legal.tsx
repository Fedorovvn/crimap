"use client";

import { InfoIcon, ScaleIcon } from "lucide-react";
import { useI18n } from "./i18n";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../components/ui/tooltip";
import { isPublishableLegal, penaltyLabel, type LegalAssessment, type LegalPenalty } from "./legal-model";

const stageLabels = { investigation: "По версии следствия", charged: "Предъявлено обвинение", trial: "Дело в суде", judgment: "Квалификация по судебному решению" };
const codeLabels = { criminal: "УК Венгрии", "petty-offense": "Закон о правонарушениях", administrative: "Административное законодательство" };

function PenaltyText({ penalty }: { penalty: LegalPenalty }) {
  const {locale}=useI18n();
  const label = penaltyLabel(penalty,locale);
  if(locale!=="ru") {
    if(!['imprisonment','detention','community-service'].includes(penalty.kind)) return <>{label}</>;
    const match=label.match(/^(.*?)(\d[\d\s.,-]*\s(?:years?|months?|days?|hours?|év|hónap|nap|óra))(.*)$/);
    return match?<>{match[1]}<strong>{match[2]}</strong>{match[3]}</>:<>{label}</>;
  }
  const suffix = penalty.kind === "imprisonment" ? " лишения свободы"
    : penalty.kind === "detention" ? " ареста"
    : penalty.kind === "community-service" ? " общественных работ" : null;
  if (!suffix) return <>{label}</>;
  const prefix = label.startsWith("до ") ? "до " : "";
  return <>{prefix}<strong>{label.slice(prefix.length, -suffix.length)}</strong>{suffix}</>;
}

export function IncidentLegal({ assessments = [], embedded = false }: { assessments?: LegalAssessment[]; embedded?: boolean }) {
  const {t,locale}=useI18n();
  const visible = assessments.filter(isPublishableLegal);
  if (!visible.length) return null;
  return <section className={`incident-legal${embedded ? " incident-legal--participant" : ""}`} aria-label={t("Правовая квалификация")}>
    {!embedded && <h3 className="font-semibold flex items-center gap-2"><ScaleIcon size={18} aria-hidden="true" />{t("Правовая квалификация")}</h3>}
    {visible.map((entry) => <div className="legal-entry" key={entry.key}>
      {!embedded && <p className="legal-subject">{entry.subjectLabel}</p>}
      {entry.qualification !== "official" && <p className="legal-unconfirmed">{t(entry.qualification === "reported" ? "По сообщению СМИ, не подтверждено официально" : "Возможная квалификация, не подтверждена официально")}</p>}
      <p className="legal-offense-line"><ScaleIcon size={14} aria-hidden="true" /><a className="legal-offense" href={entry.source.url} target="_blank" rel="noreferrer" title={`${t(stageLabels[entry.stage])} · ${entry.source.label}`}>{entry.offense.charAt(0).toLocaleUpperCase(locale) + entry.offense.slice(1)}</a></p>
      <p className="legal-line"><span className="legal-penalty">{entry.penalties.length ? entry.penalties.map((penalty, i) => <span key={i}>{i > 0 && "; "}<PenaltyText penalty={penalty} /></span>) : t("наказание пока не уточнено")}{" "}
        <TooltipProvider><Tooltip><TooltipTrigger asChild><button type="button" className="legal-info" aria-label={t("О правовой информации")}><InfoIcon size={15} aria-hidden="true" /></button></TooltipTrigger><TooltipContent side="top" sideOffset={6} className="legal-tooltip">{t("Это справочное сопоставление с законом; меру пресечения и наказание определяет суд.")}</TooltipContent></Tooltip></TooltipProvider>
      </span><span className="legal-statutes">{entry.statutes.map((law, i) => <span key={`${law.act}-${law.section}`}>{i > 0 && ", "}<a href={law.url} target="_blank" rel="noreferrer" title={`${t(codeLabels[law.code])} · ${law.act} · ${t("редакция от")} ${law.versionDate} · ${entry.condition}`}>{law.section}</a></span>)}</span></p>
    </div>)}
  </section>;
}
