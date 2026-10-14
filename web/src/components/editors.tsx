"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Chip, Field, inputCls } from "./ui";
import type { Education, Experience, Preferences, Profile, Project } from "@/lib/types";

export const CITIES = ["Bengaluru", "Mumbai", "Delhi", "Gurugram", "Noida", "Hyderabad", "Pune", "Chennai", "Kolkata", "Ahmedabad", "Jaipur", "Chandigarh", "Kochi", "Indore"];
export const JOB_TYPES = [
  { id: "internship", label: "Internship" },
  { id: "full_time", label: "Full-time" },
  { id: "part_time", label: "Part-time" },
  { id: "contract", label: "Contract / freelance" },
];
export const LEVELS = [
  { id: "student", label: "Student" },
  { id: "fresher", label: "Fresher" },
  { id: "1-3", label: "1–3 yrs" },
  { id: "3-5", label: "3–5 yrs" },
  { id: "5+", label: "5+ yrs" },
];

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

export function TagInput({ values, onChange, placeholder, suggestions = [] }: { values: string[]; onChange: (v: string[]) => void; placeholder: string; suggestions?: string[] }) {
  const [draft, setDraft] = useState("");
  const add = (v: string) => {
    const t = v.trim();
    if (t && !values.some((x) => x.toLowerCase() === t.toLowerCase())) onChange([...values, t]);
    setDraft("");
  };
  const unused = suggestions.filter((s) => !values.some((v) => v.toLowerCase() === s.toLowerCase()));
  return (
    <div>
      <div className="flex flex-wrap gap-1.5 rounded-xl bg-white/[0.03] p-2 hairline">
        <AnimatePresence initial={false}>
          {values.map((v) => (
            <motion.span
              key={v}
              layout
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.6, opacity: 0 }}
              className="inline-flex items-center gap-1 rounded-full bg-ice/12 py-1 pr-1.5 pl-3 text-sm text-frost shadow-[inset_0_0_0_1px_rgba(125,211,252,0.3)]"
            >
              {v}
              <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} className="rounded-full p-0.5 hover:bg-white/10" aria-label={`Remove ${v}`}>
                <X size={12} />
              </button>
            </motion.span>
          ))}
        </AnimatePresence>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add(draft);
            } else if (e.key === "Backspace" && !draft && values.length) {
              onChange(values.slice(0, -1));
            }
          }}
          onBlur={() => draft && add(draft)}
          placeholder={placeholder}
          className="min-w-[8rem] flex-1 bg-transparent px-1.5 py-1 text-sm outline-none placeholder:text-ink-3"
        />
      </div>
      {unused.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {unused.slice(0, 8).map((s) => (
            <button key={s} type="button" onClick={() => add(s)} className="rounded-full px-2.5 py-1 text-xs text-ink-3 hairline hover:text-ink">
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Lines({ values, onChange, placeholder }: { values: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  return (
    <div className="space-y-1.5">
      {values.map((b, i) => (
        <div key={i} className="flex gap-2">
          <textarea
            value={b}
            rows={2}
            onChange={(e) => onChange(values.map((x, j) => (j === i ? e.target.value : x)))}
            className={`${inputCls} resize-none`}
          />
          <button type="button" onClick={() => onChange(values.filter((_, j) => j !== i))} className="self-start rounded-lg p-2 text-ink-3 hover:text-bad" aria-label="Remove">
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...values, ""])} className="flex items-center gap-1 text-xs text-ice hover:text-frost">
        <Plus size={12} /> {placeholder}
      </button>
    </div>
  );
}

export function ProfileEditor({ value, onChange }: { value: Profile; onChange: (p: Profile) => void }) {
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => onChange({ ...value, [k]: v });
  const setExp = (i: number, e: Partial<Experience>) => set("experience", value.experience.map((x, j) => (j === i ? { ...x, ...e } : x)));
  const setEdu = (i: number, e: Partial<Education>) => set("education", value.education.map((x, j) => (j === i ? { ...x, ...e } : x)));
  const setProj = (i: number, e: Partial<Project>) => set("projects", value.projects.map((x, j) => (j === i ? { ...x, ...e } : x)));

  return (
    <div className="space-y-8">
      <section className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name"><input className={inputCls} value={value.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="Headline"><input className={inputCls} value={value.headline} placeholder="e.g. Data analyst · Python, SQL" onChange={(e) => set("headline", e.target.value)} /></Field>
        <Field label="Email"><input className={inputCls} value={value.email} onChange={(e) => set("email", e.target.value)} /></Field>
        <Field label="Phone"><input className={inputCls} value={value.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
        <Field label="Location"><input className={inputCls} value={value.location} onChange={(e) => set("location", e.target.value)} /></Field>
        <Field label="Links" hint="LinkedIn, GitHub, portfolio. Press Enter to add.">
          <TagInput values={value.links} onChange={(v) => set("links", v)} placeholder="Add link" />
        </Field>
      </section>

      <Field label="Skills" hint="Used for matching and to tailor your resume. Remove anything you don't want highlighted.">
        <TagInput values={value.skills} onChange={(v) => set("skills", v)} placeholder="Add skill" />
      </Field>

      <section>
        <SectionHead title="Experience" onAdd={() => set("experience", [...value.experience, { title: "", company: "", start: "", end: "", bullets: [] }])} />
        <div className="space-y-3">
          {value.experience.map((e, i) => (
            <div key={i} className="space-y-3 rounded-2xl bg-white/[0.02] p-4 hairline">
              <div className="grid gap-3 sm:grid-cols-2">
                <input className={inputCls} placeholder="Title" value={e.title} onChange={(ev) => setExp(i, { title: ev.target.value })} />
                <input className={inputCls} placeholder="Company" value={e.company} onChange={(ev) => setExp(i, { company: ev.target.value })} />
                <input className={inputCls} placeholder="Start" value={e.start ?? ""} onChange={(ev) => setExp(i, { start: ev.target.value })} />
                <input className={inputCls} placeholder="End" value={e.end ?? ""} onChange={(ev) => setExp(i, { end: ev.target.value })} />
              </div>
              <Lines values={e.bullets} onChange={(b) => setExp(i, { bullets: b })} placeholder="Add bullet" />
              <RemoveRow onClick={() => set("experience", value.experience.filter((_, j) => j !== i))} />
            </div>
          ))}
        </div>
      </section>

      <section>
        <SectionHead title="Education" onAdd={() => set("education", [...value.education, { degree: "", institution: "" }])} />
        <div className="space-y-3">
          {value.education.map((e, i) => (
            <div key={i} className="grid gap-3 rounded-2xl bg-white/[0.02] p-4 hairline sm:grid-cols-2">
              <input className={inputCls} placeholder="Degree" value={e.degree} onChange={(ev) => setEdu(i, { degree: ev.target.value })} />
              <input className={inputCls} placeholder="Institution" value={e.institution} onChange={(ev) => setEdu(i, { institution: ev.target.value })} />
              <input className={inputCls} placeholder="Start" value={e.start ?? ""} onChange={(ev) => setEdu(i, { start: ev.target.value })} />
              <input className={inputCls} placeholder="End / expected" value={e.end ?? ""} onChange={(ev) => setEdu(i, { end: ev.target.value })} />
              <input className={inputCls} placeholder="CGPA / %" value={e.score ?? ""} onChange={(ev) => setEdu(i, { score: ev.target.value })} />
              <RemoveRow onClick={() => set("education", value.education.filter((_, j) => j !== i))} />
            </div>
          ))}
        </div>
      </section>

      <section>
        <SectionHead title="Projects" onAdd={() => set("projects", [...value.projects, { name: "", description: "", tech: [] }])} />
        <div className="space-y-3">
          {value.projects.map((p, i) => (
            <div key={i} className="space-y-3 rounded-2xl bg-white/[0.02] p-4 hairline">
              <input className={inputCls} placeholder="Project name" value={p.name} onChange={(ev) => setProj(i, { name: ev.target.value })} />
              <textarea className={`${inputCls} resize-none`} rows={2} placeholder="What you built and the result" value={p.description} onChange={(ev) => setProj(i, { description: ev.target.value })} />
              <RemoveRow onClick={() => set("projects", value.projects.filter((_, j) => j !== i))} />
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-6 sm:grid-cols-2">
        <Field label="Achievements"><Lines values={value.achievements} onChange={(v) => set("achievements", v)} placeholder="Add achievement" /></Field>
        <Field label="Certifications"><Lines values={value.certifications} onChange={(v) => set("certifications", v)} placeholder="Add certification" /></Field>
      </section>
    </div>
  );
}

function SectionHead({ title, onAdd }: { title: string; onAdd: () => void }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h3 className="text-xs font-medium tracking-wide text-ink-3 uppercase">{title}</h3>
      <button type="button" onClick={onAdd} className="flex items-center gap-1 text-xs text-ice hover:text-frost"><Plus size={12} /> Add</button>
    </div>
  );
}

function RemoveRow({ onClick }: { onClick: () => void }) {
  return (
    <div className="flex justify-end sm:col-span-2">
      <button type="button" onClick={onClick} className="flex items-center gap-1 text-xs text-ink-3 hover:text-bad"><Trash2 size={12} /> Remove</button>
    </div>
  );
}

export function PrefsEditor({ value, onChange, suggestedRoles = [] }: { value: Preferences; onChange: (p: Preferences) => void; suggestedRoles?: string[] }) {
  const set = <K extends keyof Preferences>(k: K, v: Preferences[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="space-y-7">
      <Field label="What are you looking for?">
        <div className="flex flex-wrap gap-2">
          {JOB_TYPES.map((t) => (
            <Chip key={t.id} active={value.job_types.includes(t.id)} onClick={() => set("job_types", toggle(value.job_types, t.id))}>{t.label}</Chip>
          ))}
        </div>
      </Field>
      <Field label="Roles" hint="Kold also matches closely related titles (e.g. Data Analyst → Analytics, BI).">
        <TagInput values={value.roles} onChange={(v) => set("roles", v)} placeholder="Add a role" suggestions={suggestedRoles} />
      </Field>
      <Field label="Experience level">
        <div className="flex flex-wrap gap-2">
          {LEVELS.map((l) => (
            <Chip key={l.id} active={value.experience_level === l.id} onClick={() => set("experience_level", l.id)}>{l.label}</Chip>
          ))}
        </div>
      </Field>
      <Field label="Where can you work?">
        <div className="space-y-2.5">
          <Toggle checked={value.onsite_india} onChange={(v) => set("onsite_india", v)} title="On-site or hybrid in India" />
          <AnimatePresence initial={false}>
            {value.onsite_india && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden pl-1">
                <p className="mb-2 text-xs text-ink-3">Cities (leave empty for anywhere in India)</p>
                <div className="flex flex-wrap gap-1.5 pb-1">
                  {CITIES.map((c) => (
                    <Chip key={c} active={value.cities.includes(c)} onClick={() => set("cities", toggle(value.cities, c))} className="!px-3 !py-1 !text-xs">{c}</Chip>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <Toggle checked={value.remote_india} onChange={(v) => set("remote_india", v)} title="Remote, Indian companies" />
          <Toggle checked={value.remote_global} onChange={(v) => set("remote_global", v)} title="Remote for US / UK / Europe / global companies" sub="Only roles that explicitly accept candidates in India" />
          <Toggle checked={value.include_unclear_remote} onChange={(v) => set("include_unclear_remote", v)} title="Also show remote roles that don't state eligibility" sub="Marked clearly so you can check before applying" />
        </div>
      </Field>
      <div className="grid gap-6 sm:grid-cols-2">
        <Field label="Never show these companies" hint="e.g. your current employer">
          <TagInput values={value.exclude_companies} onChange={(v) => set("exclude_companies", v)} placeholder="Company name" />
        </Field>
        <Field label="Hide titles containing">
          <TagInput values={value.exclude_keywords} onChange={(v) => set("exclude_keywords", v)} placeholder="e.g. sales" />
        </Field>
      </div>
    </div>
  );
}

export function Toggle({ checked, onChange, title, sub }: { checked: boolean; onChange: (v: boolean) => void; title: string; sub?: string }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex w-full items-center gap-3 rounded-2xl bg-white/[0.02] px-4 py-3 text-left hairline transition hover:bg-white/[0.04]">
      <span className="flex-1">
        <span className="block text-sm text-ink">{title}</span>
        {sub && <span className="mt-0.5 block text-xs text-ink-3">{sub}</span>}
      </span>
      <span className={`relative h-6 w-10 shrink-0 rounded-full transition ${checked ? "bg-ice/70" : "bg-white/10"}`}>
        <motion.span layout transition={{ type: "spring", stiffness: 500, damping: 32 }} className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow ${checked ? "right-1" : "left-1"}`} />
      </span>
    </button>
  );
}
