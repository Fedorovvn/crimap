import { useI18n } from "./i18n";
import { translate, type Locale } from "./locale";
import type { ReactNode } from "react";
import { contextOriginLabel, isPublishableContext, type ContextClaim } from "./context-model";

const verificationLabels = {
  unverified: "Не подтверждено независимо", corroborated: "Есть независимое подтверждение",
  disputed: "Есть противоречия", retracted: "Сведения отозваны",
};

/** Source names become links inside the sentence; extra evidence remains inline. */
function linkedText(claim: ContextClaim, locale: Locale) {
  const used = new Set<number>();
  const nodes: ReactNode[] = [];
  const aliases = claim.evidence.flatMap((e, i) => [...new Set([e.label, e.label.replace(/\.hu$/i, "")])].map((name) => ({ name, i })))
    .filter((a) => a.name.length > 2).sort((a, b) => b.name.length - a.name.length);
  const link = (i: number, label: string, key: string) => {
    const e = claim.evidence[i];
    const relation = e.relation === "disputes" ? "Оспаривающий источник" : e.relation === "background" ? "Контекст" : contextOriginLabel(claim);
    return <a key={key} href={e.url} target="_blank" rel="noreferrer" title={[translate(relation,locale), translate(verificationLabels[claim.verification],locale), e.attribution].filter(Boolean).join(" · ")}>{label}</a>;
  };
  let cursor = 0;
  while (cursor < claim.text.length) {
    const next = aliases.map((a) => ({ ...a, at: claim.text.toLocaleLowerCase().indexOf(a.name.toLocaleLowerCase(), cursor) }))
      .filter((a) => a.at >= 0).sort((a, b) => a.at - b.at || b.name.length - a.name.length)[0];
    if (!next) { nodes.push(claim.text.slice(cursor)); break; }
    nodes.push(claim.text.slice(cursor, next.at), link(next.i, claim.text.slice(next.at, next.at + next.name.length), `text-${next.at}`));
    used.add(next.i);
    cursor = next.at + next.name.length;
  }
  claim.evidence.forEach((e, i) => {
    if (!used.has(i)) nodes.push(" (", link(i, e.label, `extra-${i}`), ")");
  });
  return nodes;
}

export function ContextClaims({ claims, title = "Сведения и версии" }: { claims: ContextClaim[]; title?: string }) {
  const {t,locale}=useI18n();
  const visible = claims.filter(isPublishableContext);
  if (!visible.length) return null;
  return <section className="context-claims" aria-label={t(title)}>
    {title.startsWith(t("О группе:")) && <p className="context-heading">{title}</p>}
    {visible.map((claim) => <p className="context-text" key={claim.key} data-origin={claim.origin} data-verification={claim.verification}>
      {claim.origin === "model" && <><strong>{t('Гипотеза модели')}</strong>{` (${t("неофициально")}): `}</>}
      {(claim.verification === "disputed" || claim.verification === "retracted") && <><strong>{t(verificationLabels[claim.verification])}</strong>{". "}</>}
      <span className="context-prose">{linkedText(claim,locale)}</span>
      {claim.origin === "model" && <>{" "}<span>{t('Предположение, не установленный факт')}</span>{`. ${t("Основание:")} `}{claim.rationale}</>}
    </p>)}
  </section>;
}
