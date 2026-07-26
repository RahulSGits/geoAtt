'use client'

import { motion, useReducedMotion } from 'motion/react'
import Link from 'next/link'
import {
  ArrowRight,
  BarChart3,
  Building2,
  CalendarCheck,
  Clock,
  Fingerprint,
  MapPin,
  Moon,
  Eye,
  Info,
  Lock,
  ScanFace,
  Server,
  ShieldCheck,
  Sparkles,
  Sun,
  Users,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import Globe from '@/components/Globe'
import TiltCard from '@/components/TiltCard'
import { useMounted } from '@/lib/useMounted'

const features = [
  {
    icon: ScanFace,
    title: 'Face-verified check-in',
    desc: 'A 128-point face template plus a blink liveness gate, matched on the server so a photo cannot pass.',
  },
  {
    icon: MapPin,
    title: 'Geofenced sites',
    desc: 'Draw a radius on the map. Location is re-validated server-side on every check-in, GPS accuracy included.',
  },
  {
    icon: Clock,
    title: 'Shift engine',
    desc: 'Working windows, grace periods and presence thresholds that decide each day automatically.',
  },
  {
    icon: CalendarCheck,
    title: 'Leave workflow',
    desc: 'Employees request, HR approves, and approved days land on the attendance sheet on their own.',
  },
  {
    icon: BarChart3,
    title: 'Live analytics',
    desc: 'Attendance trends, department headcount and status mix, exportable to CSV in one click.',
  },
  {
    icon: ShieldCheck,
    title: 'Row-level security',
    desc: 'Postgres RLS scopes every query to its owner. Employees see their data, HR sees the company.',
  },
]

const steps = [
  { n: '01', t: 'Enroll', d: 'Each employee registers their face once, in the browser.' },
  { n: '02', t: 'Check in', d: 'Location and face are verified before anything is written.' },
  { n: '03', t: 'Track', d: 'Hours accrue; the daily status computes itself in Postgres.' },
  { n: '04', t: 'Report', d: 'HR reviews live dashboards and exports payroll-ready data.' },
]

const aboutPoints = [
  {
    icon: Lock,
    title: 'Your face never leaves as a photo',
    desc: 'Enrollment converts the camera frame into a 128-number descriptor and discards the image. The numbers cannot be turned back into a picture, so there is no photo library to leak.',
  },
  {
    icon: Server,
    title: 'Checks run where they cannot be edited',
    desc: 'Face matching, geofence distance and shift timing are all evaluated server-side. A modified browser can send whatever it likes; it still will not produce a valid check-in.',
  },
  {
    icon: Eye,
    title: 'Everyone sees the same record',
    desc: 'Employees see their own attendance in full, including any correction HR makes and why. Edits are notified rather than silent, so the sheet is never a surprise at month end.',
  },
  {
    icon: Building2,
    title: 'Fits how teams actually work',
    desc: 'On-site, remote and hybrid each carry their own rules. Remote staff are not forced through a geofence that was never meant for them, and field sites keep theirs.',
  },
]

export default function Landing() {
  const { resolvedTheme, setTheme } = useTheme()
  const mounted = useMounted()
  const reduceMotion = useReducedMotion()

  const isDark = resolvedTheme === 'dark'
  const rise = reduceMotion
    ? {}
    : { initial: { opacity: 0, y: 18 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true } }

  return (
    <main className="mx-auto max-w-7xl px-4 sm:px-6">
      <nav className="flex items-center justify-between py-5">
        <div className="flex items-center gap-2">
          <span
            className="grid h-9 w-9 place-items-center rounded-xl"
            style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}
          >
            <Fingerprint size={19} />
          </span>
          <span className="text-lg font-semibold">FinAtt</span>
        </div>

        <div className="flex items-center gap-2">
          <a href="#about" className="btn btn-ghost btn-sm border-transparent">
            About
          </a>
          {mounted && (
            <button
              onClick={() => setTheme(isDark ? 'light' : 'dark')}
              aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
              className="touch-target muted rounded-lg transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)] cursor-pointer"
            >
              {isDark ? <Sun size={17} /> : <Moon size={17} />}
            </button>
          )}
          <Link href="/login" className="btn btn-primary btn-sm">
            Sign in
          </Link>
        </div>
      </nav>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="grid items-center gap-10 py-10 md:grid-cols-2 md:py-16">
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <span
            className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium"
            style={{
              borderColor: 'color-mix(in srgb, var(--primary) 25%, transparent)',
              background: 'var(--primary-soft)',
              color: 'var(--primary)',
            }}
          >
            <Sparkles size={13} />
            Presence, proven — not self-reported
          </span>

          <h1 className="mt-5 text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl md:text-6xl">
            {/*
              The arrows carry the meaning visually but read as noise aloud, so
              they are hidden from assistive tech and the word "then" is exposed
              in their place.
            */}
            Selfie{' '}
            <span aria-hidden className="gradient-text">
              →
            </span>
            <span className="sr-only"> then </span> geofence{' '}
            <span aria-hidden className="gradient-text">
              →
            </span>
            <span className="sr-only"> then </span>
            <br />
            <span className="gradient-text">marked present.</span>
          </h1>

          <p className="muted mt-5 max-w-md text-lg">
            Timesheets rely on trust. FinAtt replaces it with evidence: it confirms the
            person, the place and the hour before a single minute is recorded — then turns
            that record into reporting your payroll team can sign off on.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/login" className="btn btn-primary group px-6">
              Sign in
              <ArrowRight
                size={17}
                className="transition-transform group-hover:translate-x-0.5"
              />
            </Link>
            <a href="#about" className="btn btn-ghost px-5">
              How it works
            </a>
          </div>

          <dl className="mt-8 flex flex-wrap gap-6">
            {[
              { k: 'Blink', v: 'Liveness gate' },
              { k: 'Server-side', v: 'Face matching' },
              { k: 'Postgres RLS', v: 'Data isolation' },
            ].map((s) => (
              <div key={s.v}>
                <dt className="gradient-text text-lg font-bold">{s.k}</dt>
                <dd className="muted mt-0.5 text-xs">{s.v}</dd>
              </div>
            ))}
          </dl>
        </motion.div>

        <motion.div
          initial={reduceMotion ? false : { opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7 }}
          className="relative grid place-items-center"
        >
          <div
            aria-hidden
            className="absolute h-64 w-64 rounded-full blur-3xl"
            style={{ background: 'var(--primary-soft)' }}
          />
          <Globe size={360} />
        </motion.div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────────── */}
      <section className="py-14">
        <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
          Built for the awkward cases
        </h2>
        <p className="muted mx-auto mt-3 max-w-lg text-center">
          Remote staff, split shifts, field sites and last-minute leave — the situations
          where ordinary attendance tools quietly fall apart.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f, i) => (
            <TiltCard key={f.title} max={6}>
              <motion.article
                {...rise}
                transition={{ duration: 0.35, delay: i * 0.05 }}
                className="card lift h-full p-5"
              >
                <span
                  className="grid h-11 w-11 place-items-center rounded-xl"
                  style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}
                >
                  <f.icon size={21} />
                </span>
                <h3 className="mt-4 font-semibold">{f.title}</h3>
                <p className="muted mt-2 text-sm">{f.desc}</p>
              </motion.article>
            </TiltCard>
          ))}
        </div>
      </section>

      {/* ── How it runs ──────────────────────────────────────────────────── */}
      <section className="py-14">
        <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
          How it runs
        </h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, i) => (
            <motion.div
              key={s.n}
              {...rise}
              transition={{ duration: 0.35, delay: i * 0.08 }}
              className="card p-5"
            >
              <div className="gradient-text text-3xl font-bold">{s.n}</div>
              <h3 className="mt-3 font-semibold">{s.t}</h3>
              <p className="muted mt-1 text-sm">{s.d}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── Roles ────────────────────────────────────────────────────────── */}
      <section className="py-14">
        <div className="grid gap-4 md:grid-cols-2">
          {[
            {
              icon: Users,
              title: 'Employee portal',
              points: [
                'One-tap verified check-in and check-out',
                'Month calendar with hours and lateness',
                'Request leave and track approvals',
                'Edit your own profile and face template',
              ],
            },
            {
              icon: Building2,
              title: 'HR console',
              points: [
                'Invite employees and assign site + shift',
                'Approve leave; approved days auto-post',
                'Live trends, department mix, CSV export',
                'Manage geofences and shift rules on a map',
              ],
            },
          ].map((role) => (
            <motion.div key={role.title} {...rise} transition={{ duration: 0.4 }} className="card p-6">
              <span
                className="grid h-11 w-11 place-items-center rounded-xl"
                style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                <role.icon size={21} />
              </span>
              <h3 className="mt-4 text-lg font-semibold">{role.title}</h3>
              <ul className="mt-3 space-y-2">
                {role.points.map((p) => (
                  <li key={p} className="muted flex items-start gap-2 text-sm">
                    <span
                      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: 'var(--primary)' }}
                    />
                    {p}
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── About ────────────────────────────────────────────────────────── */}
      <section id="about" className="scroll-mt-8 py-14">
        <div className="grid gap-10 md:grid-cols-2 md:gap-14">
          <motion.div {...rise} transition={{ duration: 0.4 }}>
            <span
              className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium"
              style={{
                borderColor: 'color-mix(in srgb, var(--accent) 25%, transparent)',
                background: 'var(--accent-soft)',
                color: 'var(--accent)',
              }}
            >
              <Info size={13} />
              About FinAtt
            </span>

            <h2 className="mt-5 text-2xl font-bold tracking-tight sm:text-3xl">
              Attendance software that assumes nothing
            </h2>

            <div className="muted mt-5 space-y-4 text-sm leading-relaxed">
              <p>
                Most attendance systems record what someone typed, not what actually
                happened. A punch from a car park, a colleague clocking in a friend, a
                timesheet reconstructed from memory on a Friday afternoon — none of it is
                dishonest so much as unverifiable, and it all lands in payroll the same way.
              </p>
              <p>
                FinAtt closes that gap without making the day harder. Checking in takes one
                tap: the camera confirms the face against a template enrolled once, the
                device confirms the location sits inside the site&apos;s geofence, and the
                shift rules decide whether the day counts as on time, late or half. Every
                one of those checks runs on the server, so nothing depends on a value the
                browser could be persuaded to send.
              </p>
              <p>
                What HR gets back is a record that holds up: hours that reconcile, exceptions
                surfaced the day they happen instead of at month end, and an export that goes
                straight into payroll without a reconciliation pass.
              </p>
            </div>
          </motion.div>

          <motion.div {...rise} transition={{ duration: 0.4, delay: 0.1 }} className="space-y-4">
            {aboutPoints.map((a) => (
              <div key={a.title} className="card p-5">
                <div className="flex items-start gap-3.5">
                  <span
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-xl"
                    style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}
                  >
                    <a.icon size={19} />
                  </span>
                  <div>
                    <h3 className="font-semibold">{a.title}</h3>
                    <p className="muted mt-1.5 text-sm leading-relaxed">{a.desc}</p>
                  </div>
                </div>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────────────── */}
      <section className="py-14">
        <div className="glass-strong relative overflow-hidden p-8 text-center sm:p-12">
          <div
            aria-hidden
            className="absolute -left-10 -top-10 h-40 w-40 rounded-full blur-3xl"
            style={{ background: 'var(--info-soft)' }}
          />
          <div
            aria-hidden
            className="absolute -bottom-10 -right-10 h-40 w-40 rounded-full blur-3xl"
            style={{ background: 'var(--accent-soft)' }}
          />
          <Users size={30} className="mx-auto" style={{ color: 'var(--primary)' }} />
          <h2 className="mt-4 text-2xl font-bold sm:text-3xl">Already part of a team?</h2>
          <p className="muted mx-auto mt-2 max-w-md">
            Sign in with your work email or employee ID. Accounts are created by your HR
            team — there is no public sign-up.
          </p>
          <Link href="/login" className="btn btn-primary mt-6 px-6">
            Sign in <ArrowRight size={17} />
          </Link>
        </div>
      </section>

      <footer className="muted border-t border-[var(--border)] py-8 text-center text-sm">
        <p>FinAtt — Attendance &amp; Workforce Management</p>
        <p className="mt-1 text-xs">
          Face templates are stored as mathematical descriptors, never as photographs.
        </p>
      </footer>
    </main>
  )
}
