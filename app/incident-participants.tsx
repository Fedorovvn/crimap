import { ArrowUpRightIcon, CrossIcon, SearchIcon, SkullIcon, UsersRoundIcon } from "lucide-react";
import { useI18n } from "./i18n";
import { createContext, useContext } from "react";
import { dateLocales } from "./locale";
import { HandcuffsIcon } from "./incident-icons";
import { ContextClaims } from "./context-claims";
import type { ContextClaim } from "./context-model";
import { IncidentLegal } from "./incident-legal";
import type { LegalAssessment } from "./legal-model";
import { ageLabel, avatarFor, countryFlag, participantsForDisplay, participantStatusLabel, type Participant, type PersonProfile } from "./participants-model";
const MissingPeopleContext=createContext(false);

function Avatar({ profile, small = false }: { profile: Participant["profile"]; small?: boolean }) {
  const avatar = avatarFor(profile);
  const file = ["elderly-male", "person-neutral", "child-neutral"].includes(avatar) ? `${avatar}-refined` : avatar;
  return (
    <span className={`participant-avatar${small ? " participant-avatar--small" : ""}`} aria-hidden="true">
      <img src={`/avatars/profile/${file}.png`} alt="" width={80} height={80} loading="lazy" />
      {profile.kind === "group" && profile.count != null && <span className="participant-count">×{profile.count}</span>}
    </span>
  );
}

function PersonFacts({ person }: { person: PersonProfile }) {
  const {t,locale}=useI18n();
  const gender = person.gender === "male" ? "Мужчина" : person.gender === "female" ? "Женщина" : "Пол не указан";
  const child = (person.age != null && person.age < 18) || (person.age == null && person.ageGroup === "child");
  const genderLabel = child && person.gender ? person.gender === "male" ? "Мальчик" : "Девочка" : gender;
  return <>
    <p className="participant-facts">{t(genderLabel)}<span aria-hidden="true"> · </span>{person.age != null ? ageLabel(person.age,locale) : t("Возраст не указан")}</p>
    {person.citizenship && <p className="participant-country"><span className="participant-flag" aria-hidden="true">{countryFlag(person.citizenship.code)}</span>{t("Гражданство:")} {new Intl.DisplayNames([dateLocales[locale]],{type:"region"}).of(person.citizenship.code) ?? person.citizenship.name}</p>}
  </>;
}

function CompactIdentity({ participant }: { participant: Participant }) {
  const {t,locale}=useI18n();
  const person = participant.profile;
  if (person.kind === "group") return <><p className="participant-name">{participant.label}</p><ParticipantStatusBadge status={participant.status} profile={person} />{person.count != null && <p className="participant-country">{t("{n} человек",{n:person.count})}</p>}</>;
  const child = person.age != null ? person.age < 18 : person.ageGroup === "child";
  const gender = person.gender === "male" ? (child ? "Мальчик" : "Мужчина") : person.gender === "female" ? (child ? "Девочка" : "Женщина") : (child ? "Ребёнок" : "Человек");
  const facts = `${t(gender)}${person.age != null ? `, ${ageLabel(person.age,locale)}` : ""}`;
  return <>
    <p className="participant-name">{person.name || (person.gender || person.age != null || person.ageGroup ? facts : participant.label)}</p>
    <ParticipantStatusBadge status={participant.status} profile={person} />
    {person.name && (person.gender || person.age != null || person.ageGroup) && <p className="participant-country">{facts}</p>}
    {person.citizenship && <p className="participant-country"><span className="participant-flag" aria-hidden="true">{countryFlag(person.citizenship.code)}</span>{t("Гражданство:")} {new Intl.DisplayNames([dateLocales[locale]],{type:"region"}).of(person.citizenship.code) ?? person.citizenship.name}</p>}
  </>;
}

const roleLabels = { suspect: "Подозреваемые", victim: "Потерпевшие", convicted: "Осуждённые", involved: "Другие участники" } as const;

function ParticipantStatusBadge({ status, profile }: Pick<Participant, "status" | "profile">) {
  const {t}=useI18n();
  const missing=useContext(MissingPeopleContext);
  return <span className="participant-status" data-status={status}>
    {status === "deceased" && <SkullIcon size={14} aria-hidden="true" strokeWidth={2.1} />}
    {status === "injured" && <CrossIcon size={14} aria-hidden="true" strokeWidth={2.1} />}
    {(status === "detained" || status === "in-custody") && <HandcuffsIcon className="size-3.5" aria-hidden="true" />}
    {status === "wanted" && <SearchIcon size={14} aria-hidden="true" />}
    {t(missing&&status==='wanted'?'Пропал без вести':participantStatusLabel(status, profile))}
  </span>;
}

function ParticipantSource({ participant, top = false }: { participant: Participant; top?: boolean }) {
  const {locale}=useI18n();
  return <div className={top ? "participant-source-meta" : "participant-footer"}><a className="participant-source" href={participant.sourceUrl} target="_blank" rel="noreferrer">{participant.sourceLabel}<ArrowUpRightIcon size={12} aria-hidden="true" /></a><time dateTime={participant.asOf}>{new Intl.DateTimeFormat(dateLocales[locale], { day: "numeric", month: "short", timeZone: "Europe/Budapest" }).format(new Date(participant.asOf))}</time></div>;
}

export function IncidentParticipants({ participants, context = [], legal = [], missingPeople=false }: { participants: Participant[]; context?: ContextClaim[]; legal?: LegalAssessment[]; missingPeople?:boolean }) {
  const {t,locale}=useI18n();
  const displayedParticipants = participantsForDisplay(participants,locale);
  return (
    <MissingPeopleContext.Provider value={missingPeople}><section className="incident-participants" aria-label={t(missingPeople?'Пропавшие люди':'Участники происшествия')}>
      <div className="participants-heading"><h3>{t('Участники')}</h3><UsersRoundIcon size={18} aria-hidden="true" /></div>
      {!participants.length ? <p className="participant-empty">{t('Сведения об участниках пока не опубликованы.')}</p> :
        (Object.keys(roleLabels) as Array<keyof typeof roleLabels>).map((role) => {
          const people = displayedParticipants.filter((p) => p.role === role);
          if (!people.length) return null;
          return <div className="participant-role-group" key={role}>
            <h4>{t(missingPeople&&role==='involved'?'Пропавшие люди':roleLabels[role])}</h4>
            {participants.filter((p) => p.role === role && p.profile.kind === "group" && !people.some((person) => person.key === p.key)).map((group) =>
              <ContextClaims key={group.key} title={`${t("О группе:")} ${group.label}`} claims={context.filter((claim) => claim.subject.kind === "participant" && claim.subject.participantKey === group.key)} />
            )}
            {people.map((participant) => <article className={`participant-card${role === "suspect" ? " participant-card--compact" : ""}`} data-status={participant.status} key={participant.key}>
              <div className={role === "suspect" ? "participant-header" : undefined}>
              <div className="participant-main">
                <Avatar profile={participant.profile} />
                <div className="participant-identity">
                  {role === "suspect" ? <CompactIdentity participant={participant} /> : <><p className="participant-name">{participant.profile.kind === "person" && participant.profile.name || participant.label}</p>
                  <ParticipantStatusBadge status={participant.status} profile={participant.profile} />
                  {participant.profile.kind === "person" ? <PersonFacts person={participant.profile} /> : <>
                    <p className="participant-facts">{participant.profile.count != null ? t("{n} чел.",{n:participant.profile.count}) : t("Численность уточняется")}{participant.profile.gender && ` · ${t(participant.profile.gender === "male" ? "Мужчины" : "Женщины")}`}</p>
                    <p className="participant-country">{t('Возраст и гражданство не указаны')}</p>
                  </>}</>}
                </div>
              </div>
              {role === "suspect" && <ParticipantSource participant={participant} top />}
              </div>
              {participant.note && <p className="participant-note">{participant.note}</p>}
              {participant.status === "wanted" && participant.wantedNotice && <details className="participant-wanted-notice">
                <summary><SearchIcon size={14} aria-hidden="true" />{t(participant.wantedNotice.isDemo ? "Ориентировка · тестовый пример" : "Ориентировка")}</summary>
                <p>{participant.wantedNotice.description}</p>
                {participant.wantedNotice.isDemo && <p className="wanted-demo-note">{t('Вымышленный пример для проверки дизайна. Это не действующая ориентировка.')}</p>}
                {participant.wantedNotice.sourceUrl && <a href={participant.wantedNotice.sourceUrl} target="_blank" rel="noreferrer">{t('Открыть источник ориентировки ')}<ArrowUpRightIcon size={12} aria-hidden="true" /></a>}
              </details>}
              <ContextClaims claims={context.filter((claim) => claim.subject.kind === "participant" && claim.subject.participantKey === participant.key)} />
              {(participant.role === "suspect" || participant.role === "convicted") && <IncidentLegal embedded assessments={legal.filter((entry) => entry.participantKey === (participant.sourceParticipantKey ?? participant.key))} />}
              {participant.profile.kind === "group" && participant.profile.leader && <div className="participant-leader">
                <Avatar profile={participant.profile.leader.person} small />
                <div><p className="participant-leader-label">{t('Предполагаемый лидер')}</p><p className="participant-name">{participant.profile.leader.person.name || t("Имя не указано")}</p>
                  <ParticipantStatusBadge status={participant.profile.leader.status} profile={participant.profile.leader.person} />
                  <PersonFacts person={participant.profile.leader.person} />
                  <a className="participant-source" href={participant.profile.leader.sourceUrl} target="_blank" rel="noreferrer">{t('Источник сведений о лидере ')}<ArrowUpRightIcon size={12} aria-hidden="true" /></a>
                </div>
              </div>}
              {role !== "suspect" && <ParticipantSource participant={participant} />}
            </article>)}
          </div>;
        })}
    </section></MissingPeopleContext.Provider>
  );
}
