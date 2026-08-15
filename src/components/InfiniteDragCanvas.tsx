import {
    useEffect,
    useState,
    useRef,
    useLayoutEffect,
    useCallback,
    useMemo,
    memo,
} from "react"
import { motion, AnimatePresence, useMotionValue } from "framer-motion"
import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"

// ─── Firebase / Firestore config ────────────────────────────────────────────
const FIRESTORE_PROJECT_ID = "thee-monolith"
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents`

const firebaseConfig = {
    apiKey: "AIzaSyB3comQKuAEtrCp5NlaCyzrCM06kIVynII",
    authDomain: "thee-monolith.firebaseapp.com",
    projectId: "thee-monolith",
    storageBucket: "thee-monolith.firebasestorage.app",
    messagingSenderId: "822214230428",
    appId: "1:822214230428:web:b6f9d075d3519a0600c859",
    measurementId: "G-SH4T1ZX3MM",
}

// ─── Firestore REST helpers ─────────────────────────────────────────────────
function firestoreValueToJs(value: any): any {
    if (value === undefined || value === null) return null
    if ("stringValue" in value) return value.stringValue
    if ("integerValue" in value) return parseInt(value.integerValue, 10)
    if ("doubleValue" in value) return value.doubleValue
    if ("booleanValue" in value) return value.booleanValue
    if ("nullValue" in value) return null
    if ("mapValue" in value)
        return firestoreFieldsToJs(value.mapValue.fields || {})
    if ("arrayValue" in value)
        return (value.arrayValue.values || []).map(firestoreValueToJs)
    return null
}

function firestoreFieldsToJs(fields: Record<string, any>): any {
    const out: Record<string, any> = {}
    for (const key in fields) out[key] = firestoreValueToJs(fields[key])
    return out
}

function jsValueToFirestore(value: any): any {
    if (value === null || value === undefined) return { nullValue: null }
    if (typeof value === "string") return { stringValue: value }
    if (typeof value === "number") {
        return Number.isInteger(value)
            ? { integerValue: String(value) }
            : { doubleValue: value }
    }
    if (typeof value === "boolean") return { booleanValue: value }
    if (Array.isArray(value))
        return { arrayValue: { values: value.map(jsValueToFirestore) } }
    if (typeof value === "object")
        return { mapValue: { fields: jsObjectToFirestoreFields(value) } }
    return { nullValue: null }
}

function jsObjectToFirestoreFields(
    obj: Record<string, any>
): Record<string, any> {
    const fields: Record<string, any> = {}
    for (const key in obj) fields[key] = jsValueToFirestore(obj[key])
    return fields
}

function firestoreDocToEntry(doc: any): Entry {
    const id = doc.name.split("/").pop()
    return { id, ...firestoreFieldsToJs(doc.fields || {}) } as Entry
}

async function fetchEntriesByCategory(category: string): Promise<Entry[]> {
    const body = {
        structuredQuery: {
            from: [{ collectionId: "entries" }],
            where: {
                fieldFilter: {
                    field: { fieldPath: "category" },
                    op: "EQUAL",
                    value: { stringValue: category },
                },
            },
        },
    }
    const res = await fetch(
        `${FIRESTORE_BASE}:runQuery?key=${firebaseConfig.apiKey}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        }
    )
    if (!res.ok) {
        throw new Error(
            `Firestore query failed: ${res.status} ${await res.text()}`
        )
    }
    const rows: any[] = await res.json()
    return rows
        .filter((r) => r.document)
        .map((r) => firestoreDocToEntry(r.document))
}

async function addEntry(entryData: Record<string, any>): Promise<Entry> {
    const res = await fetch(
        `${FIRESTORE_BASE}/entries?key=${firebaseConfig.apiKey}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                fields: jsObjectToFirestoreFields(entryData),
            }),
        }
    )
    if (!res.ok) {
        throw new Error(
            `Firestore add failed: ${res.status} ${await res.text()}`
        )
    }
    const doc = await res.json()
    return firestoreDocToEntry(doc)
}

async function deleteEntry(entryId: string): Promise<void> {
    const res = await fetch(
        `${FIRESTORE_BASE}/entries/${entryId}?key=${firebaseConfig.apiKey}`,
        { method: "DELETE" }
    )
    if (!res.ok) {
        throw new Error(
            `Firestore delete failed: ${res.status} ${await res.text()}`
        )
    }
}

async function updateEntry(
    entryId: string,
    entryData: Record<string, any>
): Promise<Entry> {
    const maskParams = Object.keys(entryData)
        .map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`)
        .join("&")
    const res = await fetch(
        `${FIRESTORE_BASE}/entries/${entryId}?key=${firebaseConfig.apiKey}&${maskParams}`,
        {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                fields: jsObjectToFirestoreFields(entryData),
            }),
        }
    )
    if (!res.ok) {
        throw new Error(
            `Firestore update failed: ${res.status} ${await res.text()}`
        )
    }
    const doc = await res.json()
    return firestoreDocToEntry(doc)
}

// ─── Local ownership tracking ───────────────────────────────────────────────
const MY_ENTRIES_KEY = "directory-my-entries"

function getMyEntryIds(): string[] {
    if (typeof window === "undefined") return []
    try {
        const raw = localStorage.getItem(MY_ENTRIES_KEY)
        return raw ? JSON.parse(raw) : []
    } catch (e) {
        return []
    }
}

function addMyEntryId(id: string) {
    if (typeof window === "undefined") return
    try {
        const ids = getMyEntryIds()
        if (!ids.includes(id)) {
            localStorage.setItem(MY_ENTRIES_KEY, JSON.stringify([...ids, id]))
        }
    } catch (e) {}
}

function removeMyEntryId(id: string) {
    if (typeof window === "undefined") return
    try {
        localStorage.setItem(
            MY_ENTRIES_KEY,
            JSON.stringify(getMyEntryIds().filter((x) => x !== id))
        )
    } catch (e) {}
}

const UPLOAD_WORKER_URL =
    "https://thee-monolith-upload.hamdiyaalhassan66.workers.dev"
const R2_COVERS_BUCKET = "thee-monolith-covers"
const R2_MODELS_BUCKET = "thee-monolith-models"
const R2_COVERS_PUBLIC_URL =
    "https://pub-f4415ad4893f484aad54965b9daebe52.r2.dev"
const R2_MODELS_PUBLIC_URL =
    "https://pub-47f1e1d8fb014b909d74df6e1e78811d.r2.dev"

const BOOK_MESH_URL = `${R2_MODELS_PUBLIC_URL}/book-mockup.glb`
const VINYL_MESH_URL = `${R2_MODELS_PUBLIC_URL}/vinyl-sleeve.glb`
const DVD_MESH_URL = `${R2_MODELS_PUBLIC_URL}/dvd-case.glb`

// UI category → Firestore category field
const CATEGORY_MAP: Record<string, "screen" | "sound" | "print"> = {
    Music: "sound",
    Film: "screen",
    Books: "print",
}

const REVERSE_CATEGORY_MAP: Record<string, string> = {
    sound: "Music",
    screen: "Film",
    print: "Books",
}

const DEFAULT_FILTERS = { type: "", genres: [] as string[], year: "" }

interface ImageItem {
    entryId: string
    src: string
    alt?: string
    title?: string
    creatorName?: string
    type?: string
    genre?: string
    releaseYear?: string | number
    posterName?: string
    externalLink?: string
}

interface Entry {
    id: string
    category: "screen" | "sound" | "print"
    subcategory: string
    genre?: string | null
    title: string
    creator_name: string
    cover_image_url: string | null
    external_link: string | null
    preview_url: string | null
    comment: string | null
    poster_username: string
    release_year: number | null
}

function toTitleCaseLabel(str: string): string {
    return str
        .replace(/_/g, " ")
        .toLowerCase()
        .replace(/\b\w/g, (c) => c.toUpperCase())
}

function getActionLabel(category: string): string {
    switch (category) {
        case "Music":
            return "Listen here"
        case "Film":
            return "Watch here"
        case "Books":
            return "Read here"
        default:
            return "Listen"
    }
}

function normalizeSearchText(
    value: string | number | null | undefined
): string {
    if (value === null || value === undefined) return ""
    return String(value)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
}

function toCompactSearchText(value: string): string {
    return value.replace(/[^a-z0-9]/g, "")
}

function isSubsequenceMatch(needle: string, haystack: string): boolean {
    if (!needle) return true
    let needleIndex = 0
    for (let i = 0; i < haystack.length && needleIndex < needle.length; i++) {
        if (haystack[i] === needle[needleIndex]) needleIndex += 1
    }
    return needleIndex === needle.length
}

function entryToImageItem(e: Entry): ImageItem {
    return {
        entryId: e.id,
        src: e.cover_image_url ?? "",
        alt: e.title,
        title: e.title,
        creatorName: e.creator_name,
        type: toTitleCaseLabel(e.subcategory),
        genre: e.genre ? e.genre.split(",")[0] : undefined,
        releaseYear: e.release_year ?? undefined,
        posterName: e.poster_username,
        externalLink: e.external_link ?? undefined,
    }
}

function isDuplicateEntry(
    entries: Entry[],
    category: "screen" | "sound" | "print",
    title: string,
    creatorName: string
): Entry | undefined {
    const normTitle = normalizeSearchText(title.trim())
    const normCreator = normalizeSearchText(creatorName.trim())
    return entries.find(
        (e) =>
            e.category === category &&
            normalizeSearchText(e.title) === normTitle &&
            normalizeSearchText(e.creator_name) === normCreator
    )
}

function entryMatchesSearch(entry: Entry, normalizedQuery: string): boolean {
    if (!normalizedQuery) return true

    const normalizedFields = [
        normalizeSearchText(entry.title),
        normalizeSearchText(entry.creator_name),
        normalizeSearchText(entry.release_year),
        normalizeSearchText(entry.subcategory),
        normalizeSearchText(toTitleCaseLabel(entry.subcategory ?? "")),
        normalizeSearchText(entry.genre),
        normalizeSearchText(entry.poster_username),
        normalizeSearchText(entry.comment),
    ]
    const compactQuery = toCompactSearchText(normalizedQuery)

    return normalizedFields.some((field) => {
        if (!field) return false
        if (field.includes(normalizedQuery)) return true
        const compactField = toCompactSearchText(field)
        if (compactQuery && compactField.includes(compactQuery)) return true
        return compactQuery
            ? isSubsequenceMatch(compactQuery, compactField)
            : false
    })
}

function textMatchesSearchLogic(
    query: string | number | null | undefined,
    ...rawFields: Array<string | number | null | undefined>
): boolean {
    const normalizedQuery = normalizeSearchText(query)
    if (!normalizedQuery) return true
    const compactQuery = toCompactSearchText(normalizedQuery)
    return rawFields.some((field) => {
        const normalizedField = normalizeSearchText(field)
        if (!normalizedField) return false
        if (normalizedField.includes(normalizedQuery)) return true
        const compactField = toCompactSearchText(normalizedField)
        if (compactQuery && compactField.includes(compactQuery)) return true
        return compactQuery
            ? isSubsequenceMatch(compactQuery, compactField)
            : false
    })
}

const itunesPreviewCache = new Map<string, string | null>()

async function fetchItunesPreviewUrl(
    title: string,
    artist: string
): Promise<string | null> {
    const cacheKey = `${title}::${artist}`.toLowerCase()
    if (itunesPreviewCache.has(cacheKey)) {
        return itunesPreviewCache.get(cacheKey) ?? null
    }
    try {
        const term = encodeURIComponent(`${artist} ${title}`.trim())
        const res = await fetch(
            `https://itunes.apple.com/search?term=${term}&entity=song&limit=5`
        )
        const data = await res.json()
        const previewUrl: string | null =
            data?.results?.find((r: any) => r.previewUrl)?.previewUrl ?? null
        if (previewUrl) {
            itunesPreviewCache.set(cacheKey, previewUrl)
        }
        return previewUrl
    } catch (e) {
        return null
    }
}

const CONVERGE_X = -420
const CONVERGE_Y = 320
const CLICK_THRESHOLD = 6

interface Props {
    logoGroup: {
        logo?: string
        logoDark?: string
    }
    musicCD: {
        cellSize: number
        gap: number
        patternCols: number
        patternRows: number
        hoverScale: number
        borderRadius: number
        holeSize: number
        dragScale: number
        spineDepth: number
        textureImg?: string
        textureOpacity: number
        textureBlend: string
    }
    booksGroup: {
        width: number
        spineWidth: number
        borderRadius: number
        spineDepth: number
        textureImg?: string
        textureOpacity: number
        textureBlend: string
    }
    filmGroup: {
        width: number
        spineWidth: number
        borderRadius: number
        spineDepth: number
        textureImg?: string
        textureOpacity: number
        textureBlend: string
    }
    filtersGroup: {
        blurIntensity: number
        contrast: number
        shadowIntensity: number
        noiseEnabled: boolean
        noiseOpacity: number
        noiseSize: number
        noiseBlend: string
    }
    infoGroup: {
        showInfoOnHover: boolean
        infoAccentColor: string
        infoTextColor: string
        infoFontSize: number
    }
    carouselGroup: {
        musicSpineGroup?: {
            itemWidth?: number
            itemHeight?: number
            edgeGap?: number
            spineDepth?: number
            spineTextEnabled?: boolean
            spineTextColor?: string
            spineFontSize?: number
            spineFontWeight?: number
            spineCreatorFontWeight?: number
        }
        filmSpineGroup?: {
            filmItemWidth?: number
            filmItemHeight?: number
            filmEdgeGap?: number
            filmSpineDepth?: number
            filmSpineTextEnabled?: boolean
            filmSpineTextColor?: string
            filmSpineFontSize?: number
            filmSpineFontWeight?: number
            filmSpineCreatorFontWeight?: number
        }
        booksSpineGroup?: {
            bookItemWidth?: number
            bookEdgeGap?: number
            bookSpineDepth?: number
            bookSpineTextEnabled?: boolean
            bookSpineTextColor?: string
            bookSpineFontSize?: number
            bookSpineFontWeight?: number
            bookSpineCreatorFontWeight?: number
        }
        rotationPerItem?: number
        coverflowDepth?: number
        perspective?: number
        tiltX?: number
        autoRotate?: boolean
        autoRotateSpeed?: number
        dragToRotate?: boolean
        dragSensitivity?: number
        borderRadius?: number
        shadow?: boolean
    }
}

// Generate a tileable SVG noise pattern as a data URI
function makeNoiseSvg(size: number): string {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/></filter><rect width='${size}' height='${size}' filter='url(#n)'/></svg>`
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

// Tileable woven cloth-grain pattern for hardcover book board — meant to sit
// under a multiply blend, unlike the coarser paper grain above
function makeFabricNoiseSvg(size: number): string {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'><filter id='f'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='matrix' values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.5 0'/></filter><rect width='${size}' height='${size}' filter='url(#f)'/></svg>`
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

// ─── Click sound ────────────────────────────────────────────────────────────
let sharedAudioCtx: AudioContext | null = null
function playClickSound() {
    try {
        const AudioContextClass =
            (window as any).AudioContext || (window as any).webkitAudioContext
        if (!AudioContextClass) return
        if (!sharedAudioCtx) sharedAudioCtx = new AudioContextClass()
        const ctx = sharedAudioCtx
        if (!ctx) return
        if (ctx.state === "suspended") ctx.resume()
        const now = ctx.currentTime
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = "sine"
        osc.frequency.setValueAtTime(950, now)
        osc.frequency.exponentialRampToValueAtTime(380, now + 0.05)
        gain.gain.setValueAtTime(0.15, now)
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start(now)
        osc.stop(now + 0.07)
    } catch (e) {}
}

// ─── LoadingDots ────────────────────────────────────────────────────────────
const LOADING_DOT_RADIUS = 14
const LOADING_DOT_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315]

function LoadingDots({
    size = 16,
    color = "#1C1C1C",
}: {
    size?: number
    color?: string
}) {
    return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
            {LOADING_DOT_ANGLES.map((angle, i) => {
                const rad = (angle * Math.PI) / 180
                const dx = Math.cos(rad) * LOADING_DOT_RADIUS
                const dy = -Math.sin(rad) * LOADING_DOT_RADIUS
                return (
                    <motion.circle
                        key={angle}
                        cx={24}
                        cy={24}
                        r={2}
                        fill={color}
                        animate={{ x: [dx, 0, 0, dx], y: [dy, 0, 0, dy] }}
                        transition={{
                            duration: 1.4,
                            times: [0, 0.4, 0.6, 1],
                            repeat: Infinity,
                            ease: "easeInOut",
                            delay: i * 0.08,
                        }}
                    />
                )
            })}
        </svg>
    )
}

// ─── InfoChip ───────────────────────────────────────────────────────────────
function InfoChip({
    label,
    bg,
    textColor,
    fontSize,
    flipped,
}: {
    label: string
    bg: string
    textColor: string
    fontSize: number
    flipped?: boolean
}) {
    return (
        <div
            style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "flex-start",
                padding: `${fontSize * 0.25}px 0px`,
                background: bg,
                fontFamily: "'Spline Sans Mono', monospace",
                fontWeight: 500,
                fontSize,
                lineHeight: `${Math.round(fontSize * 1.2)}px`,
                color: textColor,
                whiteSpace: "nowrap",
                boxSizing: "border-box",
            }}
        >
            {label}
        </div>
    )
}

function ListenButton({
    href,
    label = "Listen",
    bg = "#E298F2",
    textColor = "#1C1C1C",
    flipped,
    onMouseEnter,
    onMouseLeave,
}: {
    href?: string
    label?: string
    bg?: string
    textColor?: string
    flipped?: boolean
    onMouseEnter?: () => void
    onMouseLeave?: () => void
}) {
    if (!href) return null
    return (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
                e.stopPropagation()
                playClickSound()
            }}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                justifyContent: flipped ? "flex-end" : "flex-start",
                padding: flipped ? "8px 0px 8px 24px" : "8px 24px 8px 0px",
                gap: 8,
                width: "fit-content",
                height: 26,
                background: bg,
                boxSizing: "border-box",
                textDecoration: "none",
                cursor: "pointer",
                pointerEvents: "auto",
                marginTop: 8,
                alignSelf: flipped ? "flex-end" : "flex-start",
            }}
        >
            <span
                style={{
                    fontFamily: "'Spline Sans Mono', monospace",
                    fontWeight: 500,
                    fontSize: 14,
                    lineHeight: "17px",
                    color: textColor,
                }}
            >
                {label}
            </span>
        </a>
    )
}

function ViewCursor() {
    return (
        <div
            style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                padding: "4px 0px",
                gap: 8,
                width: 58,
                height: 24,
                background: "#E298F2",
                boxSizing: "border-box",
            }}
        >
            <Icon.Plus color="#1C1C1C" />
            <span
                style={{
                    fontFamily: "'Spline Sans Mono', monospace",
                    fontWeight: 500,
                    fontSize: 14,
                    lineHeight: "17px",
                    color: "#1C1C1C",
                    whiteSpace: "nowrap",
                }}
            >
                View
            </span>
        </div>
    )
}

function CloseCursor() {
    return (
        <div
            style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                padding: "4px 0px",
                gap: 8,
                width: 58,
                height: 24,
                background: "#E298F2",
                boxSizing: "border-box",
            }}
        >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                    d="M13.0306 11.9695C13.1715 12.1104 13.2506 12.3015 13.2506 12.5007C13.2506 12.7 13.1715 12.8911 13.0306 13.032C12.8897 13.1729 12.6986 13.252 12.4993 13.252C12.3001 13.252 12.109 13.1729 11.9681 13.032L7.99997 9.06261L4.0306 13.0307C3.8897 13.1716 3.69861 13.2508 3.49935 13.2508C3.30009 13.2508 3.10899 13.1716 2.9681 13.0307C2.8272 12.8898 2.74805 12.6987 2.74805 12.4995C2.74805 12.3002 2.8272 12.1091 2.9681 11.9682L6.93747 8.00011L2.96935 4.03073C2.82845 3.88984 2.7493 3.69874 2.7493 3.49948C2.7493 3.30023 2.82845 3.10913 2.96935 2.96823C3.11024 2.82734 3.30134 2.74818 3.5006 2.74818C3.69986 2.74818 3.89095 2.82734 4.03185 2.96823L7.99997 6.93761L11.9693 2.96761C12.1102 2.82671 12.3013 2.74756 12.5006 2.74756C12.6999 2.74756 12.891 2.82671 13.0318 2.96761C13.1727 3.10851 13.2519 3.2996 13.2519 3.49886C13.2519 3.69812 13.1727 3.88921 13.0318 4.03011L9.06247 8.00011L13.0306 11.9695Z"
                    fill="#1C1C1C"
                />
            </svg>
            <span
                style={{
                    fontFamily: "'Spline Sans Mono', monospace",
                    fontWeight: 500,
                    fontSize: 14,
                    lineHeight: "17px",
                    color: "#1C1C1C",
                    whiteSpace: "nowrap",
                }}
            >
                Close
            </span>
        </div>
    )
}

// ─── VinylDisc ──────────────────────────────────────────────────────────────
function VinylDisc({
    size,
    img,
    contrast = 100,
    holeSize = 12,
}: {
    size: number
    img?: string
    contrast?: number
    holeSize?: number
}) {
    const s = size / 800
    const ring = (d: number): React.CSSProperties => ({
        position: "absolute",
        width: d * s,
        height: d * s,
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
        borderRadius: "50%",
    })
    const gradient =
        "conic-gradient(from 180deg at 50% 50%, #444E5A 0deg, #516983 28.8deg, #818E62 74.61deg, #79A799 108.84deg, #6691BC 140.35deg, #444E5A 179.1deg, #818E62 235deg, #89A380 258.75deg, #6691BC 316.42deg, #516983 340.98deg, #444E5A 359.78deg, #444E5A 360deg)"
    const gradient2 =
        "conic-gradient(from 180deg at 50% 50%, #444E5A 0deg, #516983 28.8deg, #6691BC 54.04deg, #79A799 89.53deg, #818E62 114.11deg, #546253 142.8deg, #444E5A 180.42deg, #444E5A 182.6deg, #626253 230.19deg, #818E62 250.07deg, #89A380 268.53deg, #6691BC 302.4deg, #516983 331.2deg, #444E5A 359.78deg, #444E5A 360deg)"

    const holeRadius = size * (holeSize / 100) * 0.1
    const cx = size / 2
    const cy = size / 2
    const donutClip = `path(evenodd, "M ${cx - size / 2},${cy} A ${size / 2},${size / 2} 0 1,0 ${cx + size / 2},${cy} A ${size / 2},${size / 2} 0 1,0 ${cx - size / 2},${cy} Z M ${cx - holeRadius},${cy} A ${holeRadius},${holeRadius} 0 1,0 ${cx + holeRadius},${cy} A ${holeRadius},${holeRadius} 0 1,0 ${cx - holeRadius},${cy} Z")`

    const rimBorder = 4 * s
    const rimDiameter = holeRadius * 2 + rimBorder
    return (
        <div
            aria-hidden
            style={{
                position: "absolute",
                width: size,
                height: size,
                left: "50%",
                top: "50%",
                transform: "translate(-50%, -50%)",
                borderRadius: "50%",
                overflow: "hidden",
                isolation: "isolate",
                clipPath: donutClip,
                WebkitClipPath: donutClip,
            }}
        >
            {/* Ellipse 47 — outer color ring */}
            <div
                style={{
                    ...ring(800),
                    background: gradient,
                }}
            />
            {/* Ellipse 109 — cover art */}
            {img && (
                <div
                    style={{
                        ...ring(778),
                        backgroundImage: `url(${img})`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                        opacity: 0.8,
                        filter: `contrast(${contrast}%)`,
                    }}
                />
            )}
            {/* Ellipse 99 — inner label ring tint */}
            <div
                style={{
                    ...ring(232),
                    background: gradient2,
                    mixBlendMode: "color-burn",
                    transform: "translate(-50%, -50%) rotate(-90deg)",
                }}
            />
            {/* Ellipse 97 — metal spindle disc */}
            <div
                style={{
                    ...ring(200),
                    background: "#9799A5",
                }}
            />
            {/* Ellipse 98 — spindle disc rim */}
            <div
                style={{
                    ...ring(200),
                    boxSizing: "border-box",
                    border: `${2 * s}px solid #D2D0DD`,
                }}
            />
            {/* Ellipse 95 — inner metal disc */}
            <div
                style={{
                    ...ring(136),
                    background: "#C9C3C7",
                }}
            />
            {/* Ellipse 101 — dashed decorative ring */}
            <div
                style={{
                    ...ring(216),
                    mixBlendMode: "overlay",
                    border: `${8 * s}px dashed rgba(255, 255, 255, 0.3)`,
                }}
            />
            {/* Ellipse 94 — spindle hole rim, hugging the actual cutout */}
            <div
                style={{
                    position: "absolute",
                    width: rimDiameter,
                    height: rimDiameter,
                    left: "50%",
                    top: "50%",
                    transform: "translate(-50%, -50%)",
                    borderRadius: "50%",
                    boxSizing: "border-box",
                    border: `${rimBorder}px solid #E4DFE5`,
                }}
            />
        </div>
    )
}

function VinylSleeve({
    size,
    img,
    contrast = 100,
    borderRadius = 14,
    shadowIntensity = 0,
    noiseEnabled = false,
    noiseSize = 180,
    noiseOpacity = 18,
    noiseBlend = "overlay",
    textureImg,
    textureOpacity = 100,
    textureBlend = "screen",
}: {
    size: number
    img?: string
    contrast?: number
    borderRadius?: number
    shadowIntensity?: number
    noiseEnabled?: boolean
    noiseSize?: number
    noiseOpacity?: number
    noiseBlend?: string
    textureImg?: string
    textureOpacity?: number
    textureBlend?: string
}) {
    const noiseBg = makeNoiseSvg(noiseSize)
    return (
        <div
            aria-hidden
            style={{
                position: "absolute",
                inset: 0,
                borderRadius,
                overflow: "hidden",
                backgroundColor: "#0c0c0c",
            }}
        >
            {img && (
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        backgroundImage: `url(${img})`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                        filter: `contrast(${contrast}%)`,
                    }}
                />
            )}
            {shadowIntensity > 0 && img && (
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        backgroundImage: `url(${img})`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                        mixBlendMode: "multiply",
                        opacity: shadowIntensity / 100,
                        filter: `contrast(${contrast}%)`,
                    }}
                />
            )}
            {/* texture overlay — e.g. paper grain / light leak */}
            {textureImg && (
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        backgroundImage: `url(${textureImg})`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                        mixBlendMode: textureBlend as any,
                        opacity: textureOpacity / 100,
                        borderRadius,
                        pointerEvents: "none",
                    }}
                />
            )}
            {noiseEnabled && (
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        backgroundImage: noiseBg,
                        backgroundRepeat: "repeat",
                        backgroundSize: `${noiseSize}px ${noiseSize}px`,
                        opacity: noiseOpacity / 100,
                        mixBlendMode: noiseBlend as any,
                    }}
                />
            )}
        </div>
    )
}

// ─── Header Icons ───────────────────────────────────────────────────────────
const Icon = {
    Search: ({ color = "#E298F2" }: { color?: string }) => (
        <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
        >
            <path
                d="M14.5305 13.4693L11.5624 10.4999C12.4524 9.34021 12.8678 7.88541 12.7246 6.43063C12.5814 4.97585 11.8901 3.63002 10.7911 2.66616C9.69203 1.7023 8.26751 1.19257 6.80648 1.24039C5.34544 1.2882 3.9573 1.88998 2.92364 2.92364C1.88998 3.9573 1.2882 5.34544 1.24039 6.80648C1.19257 8.26751 1.7023 9.69203 2.66616 10.7911C3.63002 11.8901 4.97585 12.5814 6.43063 12.7246C7.88541 12.8678 9.34021 12.4524 10.4999 11.5624L13.4705 14.5337C13.5403 14.6034 13.6231 14.6588 13.7143 14.6965C13.8054 14.7343 13.9031 14.7537 14.0018 14.7537C14.1005 14.7537 14.1981 14.7343 14.2893 14.6965C14.3805 14.6588 14.4633 14.6034 14.533 14.5337C14.6028 14.4639 14.6581 14.3811 14.6959 14.2899C14.7337 14.1988 14.7531 14.1011 14.7531 14.0024C14.7531 13.9038 14.7337 13.8061 14.6959 13.7149C14.6581 13.6238 14.6028 13.5409 14.533 13.4712L14.5305 13.4693ZM2.74991 6.99991C2.74991 6.15934 2.99917 5.33765 3.46617 4.63874C3.93316 3.93983 4.59692 3.3951 5.37351 3.07343C6.1501 2.75175 7.00463 2.66759 7.82905 2.83158C8.65347 2.99556 9.41075 3.40034 10.0051 3.99471C10.5995 4.58908 11.0043 5.34636 11.1683 6.17078C11.3322 6.9952 11.2481 7.84973 10.9264 8.62632C10.6047 9.40291 10.06 10.0667 9.36109 10.5337C8.66218 11.0007 7.84049 11.2499 6.99991 11.2499C5.8731 11.2488 4.79277 10.8006 3.99599 10.0038C3.19921 9.20706 2.75107 8.12673 2.74991 6.99991Z"
                fill={color}
            />
        </svg>
    ),
    Caret: ({
        color = "#1C1C1C",
        rotate = 0,
    }: {
        color?: string
        rotate?: number
    }) => (
        <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={{ transform: `rotate(${rotate}deg)` }}
        >
            <path
                d="M2.64635 6.35375L7.64634 11.3537C7.69278 11.4002 7.74793 11.4371 7.80862 11.4623C7.86932 11.4874 7.93439 11.5004 8.00009 11.5004C8.0658 11.5004 8.13087 11.4874 8.19157 11.4623C8.25226 11.4371 8.30741 11.4002 8.35385 11.3537L13.3538 6.35375C13.4239 6.28382 13.4715 6.1947 13.4909 6.09765C13.5102 6.00061 13.5003 5.90002 13.4624 5.8086C13.4245 5.71719 13.3604 5.63908 13.2781 5.58414C13.1958 5.5292 13.099 5.49992 13.0001 5.5H3.0001C2.90115 5.49992 2.8044 5.5292 2.7221 5.58414C2.63981 5.63908 2.57566 5.71719 2.53778 5.8086C2.49991 5.90002 2.49001 6.00061 2.50933 6.09765C2.52866 6.1947 2.57634 6.28382 2.64635 6.35375Z"
                fill={color}
            />
        </svg>
    ),
    Funnel: ({ color = "#E298F2" }: { color?: string }) => (
        <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
        >
            <path
                d="M12.75 8.5C12.75 8.69891 12.671 8.88968 12.5303 9.03033C12.3897 9.17098 12.1989 9.25 12 9.25H4C3.80109 9.25 3.61032 9.17098 3.46967 9.03033C3.32902 8.88968 3.25 8.69891 3.25 8.5C3.25 8.30109 3.32902 8.11032 3.46967 7.96967C3.61032 7.82902 3.80109 7.75 4 7.75H12C12.1989 7.75 12.3897 7.82902 12.5303 7.96967C12.671 8.11032 12.75 8.30109 12.75 8.5ZM14.5 4.75H1.5C1.30109 4.75 1.11032 4.82902 0.96967 4.96967C0.829018 5.11032 0.75 5.30109 0.75 5.5C0.75 5.69891 0.829018 5.88968 0.96967 6.03033C1.11032 6.17098 1.30109 6.25 1.5 6.25H14.5C14.6989 6.25 14.8897 6.17098 15.0303 6.03033C15.171 5.88968 15.25 5.69891 15.25 5.5C15.25 5.30109 15.171 5.11032 15.0303 4.96967C14.8897 4.82902 14.6989 4.75 14.5 4.75ZM9.5 10.75H6.5C6.30109 10.75 6.11032 10.829 5.96967 10.9697C5.82902 11.1103 5.75 11.3011 5.75 11.5C5.75 11.6989 5.82902 11.8897 5.96967 12.0303C6.11032 12.171 6.30109 12.25 6.5 12.25H9.5C9.69891 12.25 9.88968 12.171 10.0303 12.0303C10.171 11.8897 10.25 11.6989 10.25 11.5C10.25 11.3011 10.171 11.1103 10.0303 10.9697C9.88968 10.829 9.69891 10.75 9.5 10.75Z"
                fill={color}
            />
        </svg>
    ),
    Plus: ({ color = "#1C1C1C" }: { color?: string }) => (
        <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
        >
            <path
                d="M14.25 8C14.25 8.19891 14.171 8.38968 14.0303 8.53033C13.8897 8.67098 13.6989 8.75 13.5 8.75H8.75V13.5C8.75 13.6989 8.67098 13.8897 8.53033 14.0303C8.38968 14.171 8.19891 14.25 8 14.25C7.80109 14.25 7.61032 14.171 7.46967 14.0303C7.32902 13.8897 7.25 13.6989 7.25 13.5V8.75H2.5C2.30109 8.75 2.11032 8.67098 1.96967 8.53033C1.82902 8.38968 1.75 8.19891 1.75 8C1.75 7.80109 1.82902 7.61032 1.96967 7.46967C2.11032 7.32902 2.30109 7.25 2.5 7.25H7.25V2.5C7.25 2.30109 7.32902 2.11032 7.46967 1.96967C7.61032 1.82902 7.80109 1.75 8 1.75C8.19891 1.75 8.38968 1.82902 8.53033 1.96967C8.67098 2.11032 8.75 2.30109 8.75 2.5V7.25H13.5C13.6989 7.25 13.8897 7.32902 14.0303 7.46967C14.171 7.61032 14.25 7.80109 14.25 8Z"
                fill={color}
            />
        </svg>
    ),
    Sun: ({ color = "#E298F2" }: { color?: string }) => (
        <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
        >
            <g clipPath="url(#clip0_5845_3)">
                <path
                    d="M7.5 2.5V1C7.5 0.867392 7.55268 0.740215 7.64645 0.646447C7.74021 0.552678 7.86739 0.5 8 0.5C8.13261 0.5 8.25979 0.552678 8.35355 0.646447C8.44732 0.740215 8.5 0.867392 8.5 1V2.5C8.5 2.63261 8.44732 2.75979 8.35355 2.85355C8.25979 2.94732 8.13261 3 8 3C7.86739 3 7.74021 2.94732 7.64645 2.85355C7.55268 2.75979 7.5 2.63261 7.5 2.5ZM8 4C7.20887 4 6.43552 4.2346 5.77772 4.67412C5.11992 5.11365 4.60723 5.73836 4.30448 6.46927C4.00173 7.20017 3.92252 8.00444 4.07686 8.78036C4.2312 9.55629 4.61216 10.269 5.17157 10.8284C5.73098 11.3878 6.44371 11.7688 7.21964 11.9231C7.99556 12.0775 8.79983 11.9983 9.53073 11.6955C10.2616 11.3928 10.8864 10.8801 11.3259 10.2223C11.7654 9.56448 12 8.79113 12 8C11.9988 6.93949 11.577 5.92275 10.8271 5.17285C10.0773 4.42296 9.06051 4.00116 8 4ZM3.64625 4.35375C3.74007 4.44757 3.86732 4.50028 4 4.50028C4.13268 4.50028 4.25993 4.44757 4.35375 4.35375C4.44757 4.25993 4.50028 4.13268 4.50028 4C4.50028 3.86732 4.44757 3.74007 4.35375 3.64625L3.35375 2.64625C3.25993 2.55243 3.13268 2.49972 3 2.49972C2.86732 2.49972 2.74007 2.55243 2.64625 2.64625C2.55243 2.74007 2.49972 2.86732 2.49972 3C2.49972 3.13268 2.55243 3.25993 2.64625 3.35375L3.64625 4.35375ZM3.64625 11.6462L2.64625 12.6462C2.55243 12.7401 2.49972 12.8673 2.49972 13C2.49972 13.1327 2.55243 13.2599 2.64625 13.3538C2.74007 13.4476 2.86732 13.5003 3 13.5003C3.13268 13.5003 3.25993 13.4476 3.35375 13.3538L4.35375 12.3538C4.40021 12.3073 4.43706 12.2521 4.4622 12.1914C4.48734 12.1308 4.50028 12.0657 4.50028 12C4.50028 11.9343 4.48734 11.8692 4.4622 11.8086C4.43706 11.7479 4.40021 11.6927 4.35375 11.6462C4.3073 11.5998 4.25214 11.5629 4.19145 11.5378C4.13075 11.5127 4.0657 11.4997 4 11.4997C3.9343 11.4997 3.86925 11.5127 3.80855 11.5378C3.74786 11.5629 3.69271 11.5998 3.64625 11.6462ZM12 4.5C12.0657 4.50005 12.1307 4.48716 12.1914 4.46207C12.2521 4.43697 12.3073 4.40017 12.3538 4.35375L13.3538 3.35375C13.4476 3.25993 13.5003 3.13268 13.5003 3C13.5003 2.86732 13.4476 2.74007 13.3538 2.64625C13.2599 2.55243 13.1327 2.49972 13 2.49972C12.8673 2.49972 12.7401 2.55243 12.6462 2.64625L11.6462 3.64625C11.5762 3.71618 11.5286 3.8053 11.5092 3.90235C11.4899 3.99939 11.4998 4.09998 11.5377 4.1914C11.5756 4.28281 11.6397 4.36092 11.722 4.41586C11.8043 4.4708 11.9011 4.50008 12 4.5ZM12.3538 11.6462C12.2599 11.5524 12.1327 11.4997 12 11.4997C11.8673 11.4997 11.7401 11.5524 11.6462 11.6462C11.5524 11.7401 11.4997 11.8673 11.4997 12C11.4997 12.1327 11.5524 12.2599 11.6462 12.3538L12.6462 13.3538C12.6927 13.4002 12.7479 13.4371 12.8086 13.4622C12.8692 13.4873 12.9343 13.5003 13 13.5003C13.0657 13.5003 13.1308 13.4873 13.1914 13.4622C13.2521 13.4371 13.3073 13.4002 13.3538 13.3538C13.4002 13.3073 13.4371 13.2521 13.4622 13.1914C13.4873 13.1308 13.5003 13.0657 13.5003 13C13.5003 12.9343 13.4873 12.8692 13.4622 12.8086C13.4371 12.7479 13.4002 12.6927 13.3538 12.6462L12.3538 11.6462ZM3 8C3 7.86739 2.94732 7.74021 2.85355 7.64645C2.75979 7.55268 2.63261 7.5 2.5 7.5H1C0.867392 7.5 0.740215 7.55268 0.646447 7.64645C0.552678 7.74021 0.5 7.86739 0.5 8C0.5 8.13261 0.552678 8.25979 0.646447 8.35355C0.740215 8.44732 0.867392 8.5 1 8.5H2.5C2.63261 8.5 2.75979 8.44732 2.85355 8.35355C2.94732 8.25979 3 8.13261 3 8ZM8 13C7.86739 13 7.74021 13.0527 7.64645 13.1464C7.55268 13.2402 7.5 13.3674 7.5 13.5V15C7.5 15.1326 7.55268 15.2598 7.64645 15.3536C7.74021 15.4473 7.86739 15.5 8 15.5C8.13261 15.5 8.25979 15.4473 8.35355 15.3536C8.44732 15.2598 8.5 15.1326 8.5 15V13.5C8.5 13.3674 8.44732 13.2402 8.35355 13.1464C8.25979 13.0527 8.13261 13 8 13ZM15 7.5H13.5C13.3674 7.5 13.2402 7.55268 13.1464 7.64645C13.0527 7.74021 13 7.86739 13 8C13 8.13261 13.0527 8.25979 13.1464 8.35355C13.2402 8.44732 13.3674 8.5 13.5 8.5H15C15.1326 8.5 15.2598 8.44732 15.3536 8.35355C15.4473 8.25979 15.5 8.13261 15.5 8C15.5 7.86739 15.4473 7.74021 15.3536 7.64645C15.2598 7.55268 15.1326 7.5 15 7.5Z"
                    fill={color}
                />
            </g>
            <defs>
                <clipPath id="clip0_5845_3">
                    <rect width="16" height="16" fill="white" />
                </clipPath>
            </defs>
        </svg>
    ),
    Moon: ({ color = "#1C1C1C" }: { color?: string }) => (
        <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
        >
            <path
                d="M14.7213 9.38808C14.3175 10.7062 13.5083 11.8634 12.4088 12.695C11.4434 13.4215 10.2947 13.8646 9.09155 13.9746C7.88837 14.0845 6.67836 13.8569 5.59733 13.3174C4.51631 12.7779 3.60705 11.9477 2.97162 10.9201C2.33619 9.89251 1.99974 8.70814 2.00003 7.49995C1.99569 6.08974 2.45413 4.71704 3.30503 3.59245C4.13662 2.49295 5.2938 1.68373 6.61191 1.27995C6.69878 1.2532 6.7913 1.25064 6.87952 1.27254C6.96774 1.29445 7.04832 1.33998 7.1126 1.40426C7.17688 1.46853 7.22241 1.54912 7.24432 1.63734C7.26622 1.72556 7.26366 1.81808 7.23691 1.90495C6.94868 2.85835 6.92452 3.87207 7.16698 4.83812C7.40945 5.80416 7.90947 6.68633 8.61375 7.39061C9.31803 8.09489 10.2002 8.59491 11.1662 8.83738C12.1323 9.07984 13.146 9.05568 14.0994 8.76745C14.1863 8.7407 14.2788 8.73814 14.367 8.76004C14.4552 8.78195 14.5358 8.82748 14.6001 8.89176C14.6644 8.95603 14.7099 9.03662 14.7318 9.12484C14.7537 9.21306 14.7512 9.30558 14.7244 9.39245L14.7213 9.38808Z"
                fill={color}
            />
        </svg>
    ),
}

// ─── BookCover ──────────────────────────────────────────────────────────────
const BOOK_DESIGN_WIDTH = 770
const BOOK_DESIGN_HEIGHT = 1160
const BOOK_ASPECT = BOOK_DESIGN_HEIGHT / BOOK_DESIGN_WIDTH // height / width, locked

function BookCover({
    size,
    img,
    contrast = 100,
    spineWidth = 36,
    borderRadius = 4,
    textureImg,
    textureOpacity = 100,
    textureBlend = "screen",
    mirrored = false,
}: {
    size: number
    img?: string
    contrast?: number
    spineWidth?: number
    borderRadius?: number
    textureImg?: string
    textureOpacity?: number
    textureBlend?: string
    mirrored?: boolean
}) {
    const s = size / BOOK_DESIGN_WIDTH
    const height = size * BOOK_ASPECT
    const radius = borderRadius * s
    const fabricTileSize = Math.max(24, Math.round(42 * s))
    const fabricNoiseBg = makeFabricNoiseSvg(fabricTileSize)

    return (
        <div
            aria-hidden
            style={{
                position: "absolute",
                width: size,
                height,
                left: "50%",
                top: "50%",
                transform: "translate(-50%, -50%)",
                borderRadius: radius,
            }}
        >
            {img && (
                <div
                    style={{
                        boxSizing: "border-box",
                        position: "absolute",
                        inset: 0,
                        backgroundImage: `url(${img})`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                        borderRadius: radius,
                        filter: `contrast(${contrast}%)`,
                        overflow: "hidden",
                    }}
                />
            )}

            <div
                aria-hidden
                style={{
                    position: "absolute",
                    inset: 0,
                    borderRadius: radius,
                    boxShadow: `inset 0 ${1 * s}px 0 rgba(255,255,255,0.35), inset 0 ${-1 * s}px 0 rgba(0,0,0,0.25), inset ${1 * s}px 0 0 rgba(255,255,255,0.18), inset ${-1 * s}px 0 0 rgba(0,0,0,0.2)`,
                    pointerEvents: "none",
                }}
            />

            <div
                aria-hidden
                style={{
                    position: "absolute",
                    inset: 0,
                    borderRadius: radius,
                    backgroundImage: fabricNoiseBg,
                    backgroundRepeat: "repeat",
                    backgroundSize: `${fabricTileSize}px ${fabricTileSize}px`,
                    mixBlendMode: "multiply",
                    opacity: 0.16,
                    pointerEvents: "none",
                }}
            />

            <div
                style={{
                    position: "absolute",
                    width: spineWidth * s,
                    ...(mirrored ? { right: 0 } : { left: 0 }),
                    top: 0,
                    bottom: 0,
                    background:
                        "linear-gradient(90deg, rgba(255, 255, 255, 0.16) 6.31%, rgba(0, 0, 0, 0.4) 57.72%, rgba(255, 255, 255, 0.2) 101.84%)",
                    borderRadius: mirrored
                        ? `0 ${radius}px ${radius}px 0`
                        : `${radius}px 0 0 ${radius}px`,
                }}
            />

            <div
                aria-hidden
                style={{
                    position: "absolute",
                    ...(mirrored ? { right: 0 } : { left: 0 }),
                    top: 0,
                    width: spineWidth * s,
                    height: spineWidth * s * 0.9,
                    background:
                        "radial-gradient(ellipse at 50% 0%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.2) 35%, transparent 62%), linear-gradient(180deg, transparent 55%, rgba(0,0,0,0.3) 78%, transparent 100%)",
                    borderRadius: mirrored
                        ? `${radius}px ${spineWidth * s * 0.5}px 0 0`
                        : `${radius}px ${spineWidth * s * 0.5}px 0 0`,
                    pointerEvents: "none",
                }}
            />
            <div
                aria-hidden
                style={{
                    position: "absolute",
                    ...(mirrored ? { right: 0 } : { left: 0 }),
                    bottom: 0,
                    width: spineWidth * s,
                    height: spineWidth * s * 0.9,
                    background:
                        "radial-gradient(ellipse at 50% 100%, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.18) 35%, transparent 62%), linear-gradient(0deg, transparent 55%, rgba(0,0,0,0.32) 78%, transparent 100%)",
                    borderRadius: `0 0 ${spineWidth * s * 0.5}px ${radius}px`,
                    pointerEvents: "none",
                }}
            />

            <div
                aria-hidden
                style={{
                    position: "absolute",
                    ...(mirrored
                        ? { right: spineWidth * s + 6 * s }
                        : { left: spineWidth * s + 6 * s }),
                    top: 0,
                    bottom: 0,
                    width: 2 * s,
                    background:
                        "linear-gradient(90deg, rgba(0,0,0,0.22), rgba(255,255,255,0.14))",
                    pointerEvents: "none",
                }}
            />

            {textureImg && (
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        backgroundImage: `url(${textureImg})`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                        mixBlendMode: textureBlend as any,
                        opacity: textureOpacity / 100,
                        borderRadius: radius,
                        pointerEvents: "none",
                    }}
                />
            )}

            <div
                aria-hidden
                style={{
                    position: "absolute",
                    inset: 0,
                    background:
                        "linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.03) 22%, transparent 45%, rgba(0,0,0,0.05) 100%)",
                    mixBlendMode: "soft-light",
                    borderRadius: radius,
                    pointerEvents: "none",
                }}
            />

            <div
                aria-hidden
                style={{
                    position: "absolute",
                    inset: 0,
                    background:
                        "linear-gradient(90deg, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0.05) 6%, transparent 18%)",
                    borderRadius: radius,
                    pointerEvents: "none",
                }}
            />
        </div>
    )
}

// ─── Book3DViewer support ───────────────────────────────────────────────────
const vinylGltfCache: {
    scene: THREE.Group | null
    promise: Promise<{ scene: THREE.Group }> | null
} = {
    scene: null,
    promise: null,
}

function loadVinylGltf(): Promise<{ scene: THREE.Group }> {
    if (vinylGltfCache.scene) {
        return Promise.resolve({ scene: vinylGltfCache.scene.clone(true) })
    }
    if (!vinylGltfCache.promise) {
        const promise: Promise<{ scene: THREE.Group }> = new Promise(
            (resolve, reject) => {
                new GLTFLoader().load(
                    VINYL_MESH_URL,
                    (gltf) => {
                        vinylGltfCache.scene = gltf.scene
                        resolve({ scene: gltf.scene.clone(true) })
                    },
                    undefined,
                    reject
                )
            }
        )
        vinylGltfCache.promise = promise.catch((err) => {
            vinylGltfCache.promise = null
            return Promise.reject(err)
        })
    }
    return vinylGltfCache.promise
}

const dvdGltfCache: {
    scene: THREE.Group | null
    promise: Promise<{ scene: THREE.Group }> | null
} = {
    scene: null,
    promise: null,
}

function loadDvdGltf(): Promise<{ scene: THREE.Group }> {
    if (dvdGltfCache.scene) {
        return Promise.resolve({ scene: dvdGltfCache.scene.clone(true) })
    }
    if (!dvdGltfCache.promise) {
        const promise: Promise<{ scene: THREE.Group }> = new Promise(
            (resolve, reject) => {
                new GLTFLoader().load(
                    DVD_MESH_URL,
                    (gltf) => {
                        dvdGltfCache.scene = gltf.scene
                        resolve({ scene: gltf.scene.clone(true) })
                    },
                    undefined,
                    reject
                )
            }
        )
        dvdGltfCache.promise = promise.catch((err) => {
            dvdGltfCache.promise = null
            return Promise.reject(err)
        })
    }
    return dvdGltfCache.promise
}

// Kick the mesh fetch off immediately on module load, not on first modal open,
// so by the time someone views a Music/Film entry the .glb is likely already cached.
if (typeof window !== "undefined") {
    loadVinylGltf().catch(() => {})
    loadDvdGltf().catch(() => {})
}

function getBookDominantColor(image: HTMLImageElement): any {
    const canvas = document.createElement("canvas")
    const size = 32
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext("2d")
    if (!ctx) return new THREE.Color(0x333333)
    ctx.drawImage(image, 0, 0, size, size)
    const { data } = ctx.getImageData(0, 0, size, size)
    let r = 0,
        g = 0,
        b = 0,
        count = 0
    for (let i = 0; i < data.length; i += 4) {
        r += data[i]
        g += data[i + 1]
        b += data[i + 2]
        count++
    }
    r /= count
    g /= count
    b /= count
    const color = new THREE.Color(r / 255, g / 255, b / 255)
    color.multiplyScalar(0.85)
    return color
}

const spineColorCache = new Map<string, string>()

function getDominantColorForSpine(url: string): Promise<string> {
    if (spineColorCache.has(url))
        return Promise.resolve(spineColorCache.get(url)!)
    return new Promise((resolve) => {
        const img = new Image()
        img.crossOrigin = "anonymous"
        img.onload = () => {
            try {
                const size = 24
                const canvas = document.createElement("canvas")
                canvas.width = size
                canvas.height = size
                const ctx = canvas.getContext("2d")
                if (!ctx) {
                    resolve("#0c0c0c")
                    return
                }
                ctx.drawImage(img, 0, 0, size, size)
                const { data } = ctx.getImageData(0, 0, size, size)
                let r = 0,
                    g = 0,
                    b = 0,
                    count = 0
                for (let i = 0; i < data.length; i += 4) {
                    r += data[i]
                    g += data[i + 1]
                    b += data[i + 2]
                    count++
                }
                r = Math.round(r / count)
                g = Math.round(g / count)
                b = Math.round(b / count)
                const hex = `rgb(${r}, ${g}, ${b})`
                spineColorCache.set(url, hex)
                resolve(hex)
            } catch (e) {
                resolve("#0c0c0c")
            }
        }
        img.onerror = () => resolve("#0c0c0c")
        img.src = url
    })
}

const filmSpineColorCache = new Map<string, string>()

function getDominantColorForFilmSpine(
    url: string,
    widthFraction = 0.12
): Promise<string> {
    const cacheKey = `${url}::${widthFraction.toFixed(3)}`
    if (filmSpineColorCache.has(cacheKey))
        return Promise.resolve(filmSpineColorCache.get(cacheKey)!)
    return new Promise((resolve) => {
        const img = new Image()
        img.crossOrigin = "anonymous"
        img.onload = () => {
            try {
                const sampleSize = 24
                const canvas = document.createElement("canvas")
                canvas.width = sampleSize
                canvas.height = sampleSize
                const ctx = canvas.getContext("2d")
                if (!ctx) {
                    resolve("#0c0c0c")
                    return
                }
                const srcSliceWidth = img.naturalWidth * widthFraction
                ctx.drawImage(
                    img,
                    0,
                    0,
                    srcSliceWidth,
                    img.naturalHeight,
                    0,
                    0,
                    sampleSize,
                    sampleSize
                )
                const { data } = ctx.getImageData(0, 0, sampleSize, sampleSize)
                let r = 0,
                    g = 0,
                    b = 0,
                    count = 0
                for (let i = 0; i < data.length; i += 4) {
                    r += data[i]
                    g += data[i + 1]
                    b += data[i + 2]
                    count++
                }
                const hex = `rgb(${Math.round(r / count)}, ${Math.round(g / count)}, ${Math.round(b / count)})`
                filmSpineColorCache.set(cacheKey, hex)
                resolve(hex)
            } catch (e) {
                console.warn("Film spine color sample failed for", url, e)
                resolve("#0c0c0c")
            }
        }
        img.onerror = () => {
            console.warn("Film spine color image failed to load", url)
            resolve("#0c0c0c")
        }
        img.src = url
    })
}

function blendWithOverlay(
    rgbString: string,
    overlayAlpha = 0.15
): [number, number, number] {
    const match = rgbString.match(/(\d+),\s*(\d+),\s*(\d+)/)
    if (!match) return [12, 12, 12]
    const [, r, g, b] = match.map(Number)
    return [
        r * (1 - overlayAlpha),
        g * (1 - overlayAlpha),
        b * (1 - overlayAlpha),
    ]
}

function relativeLuminance(r: number, g: number, b: number): number {
    const toLinear = (c: number) => {
        const s = c / 255
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
}

function contrastRatio(l1: number, l2: number): number {
    const lighter = Math.max(l1, l2)
    const darker = Math.min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)
}

function getContrastingSpineTextColor(rgbString: string): string {
    const [r, g, b] = blendWithOverlay(rgbString)
    const bgLum = relativeLuminance(r, g, b)
    const darkTextLum = relativeLuminance(28, 28, 28)
    const lightTextLum = relativeLuminance(254, 254, 254)
    const contrastWithDark = contrastRatio(bgLum, darkTextLum)
    const contrastWithLight = contrastRatio(bgLum, lightTextLum)
    return contrastWithDark >= contrastWithLight
        ? "rgba(28,28,28,0.92)"
        : "rgba(254,254,254,0.95)"
}

function rgbToSaturation(r: number, g: number, b: number): number {
    const max = Math.max(r, g, b) / 255
    const min = Math.min(r, g, b) / 255
    const l = (max + min) / 2
    if (max === min) return 0
    const d = max - min
    return l > 0.5 ? d / (2 - max - min) : d / (max + min)
}

const coverLightDarkCache = new Map<string, { light: string; dark: string }>()

function getCoverLightDarkColors(url: string): Promise<{ light: string; dark: string }> {
    if (coverLightDarkCache.has(url))
        return Promise.resolve(coverLightDarkCache.get(url)!)
    return new Promise((resolve) => {
        const img = new Image()
        img.crossOrigin = "anonymous"
        img.onload = () => {
            try {
                // Larger sample + smoothing disabled — a small downscale with
                // smoothing on blends thin text/small accents (flowers, thin
                // black lettering) into surrounding pixels before we ever
                // get to look at them. Nearest-neighbor at higher res keeps
                // those small vivid/dark regions intact as real pixels.
                const size = 150
                const canvas = document.createElement("canvas")
                canvas.width = size
                canvas.height = size
                const ctx = canvas.getContext("2d")!
                ctx.imageSmoothingEnabled = false
                ctx.drawImage(img, 0, 0, size, size)
                const { data } = ctx.getImageData(0, 0, size, size)

                const pixels: { r: number; g: number; b: number; lum: number; sat: number }[] = []
                for (let i = 0; i < data.length; i += 4) {
                    const r = data[i], g = data[i + 1], b = data[i + 2]
                    pixels.push({
                        r, g, b,
                        lum: relativeLuminance(r, g, b),
                        sat: rgbToSaturation(r, g, b),
                    })
                }

                const sortedByLum = [...pixels].sort((a, b) => a.lum - b.lum)
                const medianLum = sortedByLum[Math.floor(sortedByLum.length / 2)]?.lum ?? 0.5

                const lightGroup = pixels.filter((p) => p.lum >= medianLum)
                const darkGroup = pixels.filter((p) => p.lum < medianLum)

                const avgOf = (arr: typeof pixels) => {
                    const s = arr.reduce(
                        (acc, p) => ({ r: acc.r + p.r, g: acc.g + p.g, b: acc.b + p.b }),
                        { r: 0, g: 0, b: 0 }
                    )
                    const n = arr.length || 1
                    return `rgb(${Math.round(s.r / n)}, ${Math.round(s.g / n)}, ${Math.round(s.b / n)})`
                }

                // Prefer a real vivid accent color (top saturated pixels,
                // averaged together — not just one pixel, to avoid picking
                // up a single noisy outlier). If the group has no genuinely
                // saturated pixels (e.g. black text — near-zero saturation
                // by definition), fall back to its most extreme pixels by
                // luminance instead of the group's overall average, so a
                // thin black title still reads as black rather than being
                // diluted into a pale grey blend with the cream around it.
                const pickTone = (
                    group: typeof pixels,
                    extremeDirection: "darkest" | "lightest",
                    fallback: string
                ) => {
                    if (!group.length) return fallback
                    const bySat = [...group].sort((a, b) => b.sat - a.sat)
                    const topSatCount = Math.max(1, Math.round(group.length * 0.02))
                    const topSat = bySat.slice(0, topSatCount)
                    const bestSat = topSat[0]?.sat ?? 0

                    if (bestSat >= 0.2) {
                        return avgOf(topSat)
                    }

                    const byLum =
                        extremeDirection === "darkest"
                            ? [...group].sort((a, b) => a.lum - b.lum)
                            : [...group].sort((a, b) => b.lum - a.lum)
                    const extremeCount = Math.max(1, Math.round(group.length * 0.05))
                    return avgOf(byLum.slice(0, extremeCount))
                }

                const result = {
                    dark: pickTone(darkGroup, "darkest", "#1a1a1a"),
                    light: pickTone(lightGroup, "lightest", "#f5f5f5"),
                }
                coverLightDarkCache.set(url, result)
                resolve(result)
            } catch (e) {
                resolve({ light: "#f5f5f5", dark: "#1a1a1a" })
            }
        }
        img.onerror = () => resolve({ light: "#f5f5f5", dark: "#1a1a1a" })
        img.src = url
    })
}

function pickCoverTextColor(light: string, dark: string, bgRgbString: string): string {
    const parse = (s: string): [number, number, number] => {
        const m = s.match(/(\d+),\s*(\d+),\s*(\d+)/)
        return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [128, 128, 128]
    }
    const [br, bg2, bb] = parse(bgRgbString)
    const bgLum = relativeLuminance(br, bg2, bb)
    const [lr, lg, lb] = parse(light)
    const [dr, dg, db] = parse(dark)
    const lightContrast = contrastRatio(bgLum, relativeLuminance(lr, lg, lb))
    const darkContrast = contrastRatio(bgLum, relativeLuminance(dr, dg, db))
    return lightContrast >= darkContrast ? light : dark
}

function Book3DViewer({
    coverImageUrl,
    width,
    height,
}: {
    coverImageUrl: string
    width: number
    height: number
}) {
    const mountRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!coverImageUrl) return
        const mount = mountRef.current
        if (!mount) return

        const renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
        })
        renderer.setSize(width, height)
        renderer.setPixelRatio(window.devicePixelRatio)
        renderer.outputColorSpace = THREE.SRGBColorSpace
        renderer.toneMapping = THREE.ACESFilmicToneMapping
        renderer.toneMappingExposure = 1
        mount.appendChild(renderer.domElement)

        const scene = new THREE.Scene()
        const camera = new THREE.PerspectiveCamera(
            35,
            width / height,
            0.1,
            1000
        )

        const pmremGenerator = new THREE.PMREMGenerator(renderer)
        scene.environment = pmremGenerator.fromScene(
            createTiltEnvironment(),
            0.01
        ).texture

        const controls = new OrbitControls(camera, renderer.domElement)
        controls.enableDamping = true
        controls.enableRotate = false

        const key = new THREE.DirectionalLight(0xffffff, 1.5)
        key.position.set(3, 4, 5)
        scene.add(key)
        const fill = new THREE.DirectionalLight(0xffffff, 0.4)
        fill.position.set(-4, 2, 2)
        scene.add(fill)
        scene.add(new THREE.AmbientLight(0xffffff, 0.35))

        scene.add(camera)
        const cameraLight = new THREE.PointLight(0xffffff, 1.1)
        camera.add(cameraLight)

        const rig = new THREE.Group()
        scene.add(rig)
        rig.rotation.set(0, THREE.MathUtils.degToRad(45), 0)

        const tiltGroup = new THREE.Group()
        rig.add(tiltGroup)

        const standGroup = new THREE.Group()
        tiltGroup.add(standGroup)
        standGroup.rotation.set(THREE.MathUtils.degToRad(90), 0, 0)

        const TINT_TARGETS = new Set(["Spine", "BackCover", "CoverEdge"])

        let disposed = false
        const texLoader = new THREE.TextureLoader()
        texLoader.setCrossOrigin("anonymous")
        texLoader.load(coverImageUrl, (texture) => {
            if (disposed) return
            texture.colorSpace = THREE.SRGBColorSpace
            texture.flipY = false
            texture.center.set(0.5, 0.5)
            texture.needsUpdate = true

            let dominantColor
            try {
                dominantColor = getBookDominantColor(
                    texture.image as HTMLImageElement
                )
            } catch (err) {
                console.warn(
                    "Dominant color extraction failed (likely a CORS issue), falling back:",
                    err
                )
                dominantColor = new THREE.Color(0x333333)
            }

            const gltfLoader = new GLTFLoader()
            gltfLoader.load(
                BOOK_MESH_URL,
                (gltf) => {
                    if (disposed) return
                    const model = gltf.scene

                    model.traverse((obj: any) => {
                        if (obj.isMesh) {
                            const mesh = obj
                            const isArray = Array.isArray(mesh.material)
                            const mats = isArray
                                ? mesh.material
                                : [mesh.material]
                            const newMats = mats.map((m: any) => {
                                if (m.name === "CoverArt") {
                                    m.map = texture
                                    m.color.set(0xffffff)
                                    m.roughness = 0.15
                                    m.metalness = 0.08
                                    m.envMapIntensity = 1.2
                                    m.needsUpdate = true
                                    return m
                                }
                                if (TINT_TARGETS.has(m.name)) {
                                    const tinted = m.clone()
                                    tinted.color.copy(dominantColor)
                                    tinted.needsUpdate = true
                                    return tinted
                                }
                                return m
                            })
                            mesh.material = isArray ? newMats : newMats[0]
                        }
                    })

                    const box = new THREE.Box3().setFromObject(model)
                    const center = box.getCenter(new THREE.Vector3())
                    model.position.sub(center)
                    standGroup.add(model)

                    const size = box.getSize(new THREE.Vector3())
                    const maxDim = Math.max(size.x, size.y, size.z)
                    const fitDist =
                        (maxDim /
                            (2 * Math.tan((camera.fov * Math.PI) / 360))) *
                        1.6
                    camera.position.set(
                        fitDist * 0.42,
                        -fitDist * 0.12,
                        fitDist * 0.92
                    )
                    camera.lookAt(0, 0, 0)
                    controls.target.set(0, 0, 0)
                    controls.update()
                },
                undefined,
                (err) => console.error("GLTF load error", err)
            )
        })

        const maxTilt = THREE.MathUtils.degToRad(25)
        let targetTiltX = 0
        let targetTiltY = 0
        const handlePointerMove = (e: PointerEvent) => {
            const rect = mount.getBoundingClientRect()
            const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1
            const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1
            targetTiltY = nx * maxTilt
            targetTiltX = -ny * maxTilt
        }
        mount.addEventListener("pointermove", handlePointerMove)

        let frameId: number
        const animate = () => {
            frameId = requestAnimationFrame(animate)
            controls.update()
            tiltGroup.rotation.x = THREE.MathUtils.lerp(
                tiltGroup.rotation.x,
                targetTiltX,
                0.06
            )
            tiltGroup.rotation.y = THREE.MathUtils.lerp(
                tiltGroup.rotation.y,
                targetTiltY,
                0.06
            )
            renderer.render(scene, camera)
        }
        animate()

        return () => {
            disposed = true
            cancelAnimationFrame(frameId)
            mount.removeEventListener("pointermove", handlePointerMove)
            pmremGenerator.dispose()
            renderer.dispose()
            if (renderer.domElement.parentNode === mount) {
                mount.removeChild(renderer.domElement)
            }
        }
    }, [coverImageUrl, width, height])

    return (
        <div
            ref={mountRef}
            style={{
                width,
                height,
                position: "relative",
                pointerEvents: "auto",
            }}
        />
    )
}

function createTiltEnvironment(): THREE.Scene {
    const env = new THREE.Scene()
    const panelDefs: {
        pos: [number, number, number]
        color: number
        size: [number, number]
        intensity: number
    }[] = [
        { pos: [0, 4, -2], color: 0xffffff, size: [6, 3], intensity: 4 },
        { pos: [-4, 0, 1], color: 0xe298f2, size: [3, 5], intensity: 2.5 },
        { pos: [4, -1, 1], color: 0x6691bc, size: [3, 4], intensity: 2.5 },
        { pos: [0, -4, -1], color: 0x1c1c1c, size: [6, 3], intensity: 1.2 },
    ]
    panelDefs.forEach(({ pos, color, size, intensity }) => {
        const mat = new THREE.MeshBasicMaterial({
            color: new THREE.Color(color).multiplyScalar(intensity),
            side: THREE.DoubleSide,
            toneMapped: false,
        })
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(...size), mat)
        mesh.position.set(...pos)
        mesh.lookAt(0, 0, 0)
        env.add(mesh)
    })
    return env
}

function Vinyl3DViewer({
    coverImageUrl,
    width,
    height,
}: {
    coverImageUrl: string
    width: number
    height: number
}) {
    const mountRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!coverImageUrl) return
        const mount = mountRef.current
        if (!mount) return

        const renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
        })
        renderer.setSize(width, height)
        const RENDER_SCALE = 2.4
        renderer.setPixelRatio(window.devicePixelRatio * RENDER_SCALE)
        renderer.outputColorSpace = THREE.SRGBColorSpace
        renderer.toneMapping = THREE.ACESFilmicToneMapping
        renderer.toneMappingExposure = 1
        mount.appendChild(renderer.domElement)

        const scene = new THREE.Scene()
        const camera = new THREE.PerspectiveCamera(
            35,
            width / height,
            0.1,
            1000
        )

        const pmremGenerator = new THREE.PMREMGenerator(renderer)
        scene.environment = pmremGenerator.fromScene(
            createTiltEnvironment(),
            0.01
        ).texture
        const controls = new OrbitControls(camera, renderer.domElement)
        controls.enableDamping = true
        controls.enableRotate = false

        const key = new THREE.DirectionalLight(0xffffff, 1.5)
        key.position.set(3, 4, 5)
        scene.add(key)
        const fill = new THREE.DirectionalLight(0xffffff, 0.4)
        fill.position.set(-4, 2, 2)
        scene.add(fill)
        scene.add(new THREE.AmbientLight(0xffffff, 0.35))
        scene.add(camera)
        const cameraLight = new THREE.PointLight(0xffffff, 1.1)
        camera.add(cameraLight)

        const rig = new THREE.Group()
        scene.add(rig)
        rig.rotation.set(0, THREE.MathUtils.degToRad(45), 0)

        const tiltGroup = new THREE.Group()
        rig.add(tiltGroup)

        let vinylObjs: THREE.Object3D[] = []
        let vinylRestPos: THREE.Vector3[] = []
        const PULL_AXIS = new THREE.Vector3(1, 0, 0)
        const PULL_DISTANCE = 0
        const PULL_DURATION = 1.5
        const SPIN_SPEED = 2
        const clock = new THREE.Clock()
        let elapsed = 0

        let disposed = false
        const texLoader = new THREE.TextureLoader()
        texLoader.setCrossOrigin("anonymous")
        texLoader.load(coverImageUrl, (texture) => {
            if (disposed) return
            texture.colorSpace = THREE.SRGBColorSpace
            texture.flipY = false
            texture.anisotropy = renderer.capabilities.getMaxAnisotropy()
            texture.needsUpdate = true

            let dominantColor
            try {
                dominantColor = getBookDominantColor(
                    texture.image as HTMLImageElement
                )
            } catch (err) {
                console.warn(
                    "Dominant color extraction failed (likely CORS), falling back:",
                    err
                )
                dominantColor = new THREE.Color(0x333333)
            }

            loadVinylGltf()
                .then(({ scene: model }) => {
                    if (disposed) return

                    model.traverse((obj: any) => {
                        if (!obj.isMesh) return
                        const name = (obj.name || "").toLowerCase()
                        const mats = Array.isArray(obj.material)
                            ? obj.material
                            : [obj.material]

                        if (name === "cube") {
                            mats.forEach((m: any) => {
                                m.map = texture
                                m.color.set(0xffffff)
                                m.needsUpdate = true
                            })
                        } else if (name === "cube_1") {
                            mats.forEach((m: any) => {
                                m.color.copy(dominantColor)
                                m.needsUpdate = true
                            })
                        } else if (name === "spiral001_1") {
                            mats.forEach((m: any) => {
                                m.map = texture
                                m.color.set(0xffffff)
                                m.needsUpdate = true
                            })
                            vinylObjs.push(obj)
                            vinylRestPos.push(obj.position.clone())
                        } else if (name === "spiral001") {
                            mats.forEach((m: any) => {
                                m.color.copy(dominantColor).multiplyScalar(3)
                                m.needsUpdate = true
                            })
                            vinylObjs.push(obj)
                            vinylRestPos.push(obj.position.clone())
                        } else if (name === "shrinkwrap") {
                            mats.forEach((m: any) => {
                                m.transparent = true
                                m.opacity = 0.25
                                m.roughness = 0.01
                                m.metalness = 0.15
                                m.envMapIntensity = 3.5
                                m.blending = THREE.AdditiveBlending
                                if (m.map) m.color.set(0xffffff)
                                m.needsUpdate = true
                            })
                        }
                    })

                    const box = new THREE.Box3().setFromObject(model)
                    const center = box.getCenter(new THREE.Vector3())
                    model.position.sub(center)
                    tiltGroup.add(model)

                    const size = box.getSize(new THREE.Vector3())
                    const maxDim = Math.max(size.x, size.y, size.z)
                    const fitDist =
                        (maxDim /
                            (2 * Math.tan((camera.fov * Math.PI) / 360))) *
                        1.6
                    camera.position.set(
                        fitDist * 0.42,
                        -fitDist * 0.12,
                        fitDist * 0.92
                    )
                    camera.lookAt(0, 0, 0)
                    controls.target.set(0, 0, 0)
                    controls.update()
                })
                .catch((err) => console.error("GLTF load error", err))
        })

        const maxTilt = THREE.MathUtils.degToRad(25)
        let targetTiltX = 0
        let targetTiltY = 0
        const handlePointerMove = (e: PointerEvent) => {
            const rect = mount.getBoundingClientRect()
            const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1
            const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1
            targetTiltY = nx * maxTilt
            targetTiltX = -ny * maxTilt
        }
        mount.addEventListener("pointermove", handlePointerMove)

        let frameId: number
        const animate = () => {
            frameId = requestAnimationFrame(animate)
            controls.update()

            const delta = clock.getDelta()
            elapsed += delta
            const t = elapsed
            const progress = Math.min(t / PULL_DURATION, 1)
            const eased = 1 - Math.pow(1 - progress, 3)
            const slide = PULL_DISTANCE * eased

            vinylObjs.forEach((obj, i) => {
                const rest = vinylRestPos[i]
                if (!rest) return
                obj.position.set(
                    rest.x + PULL_AXIS.x * slide,
                    rest.y + PULL_AXIS.y * slide,
                    rest.z + PULL_AXIS.z * slide
                )
                obj.rotation.y += SPIN_SPEED * delta * eased
            })

            tiltGroup.rotation.x = THREE.MathUtils.lerp(
                tiltGroup.rotation.x,
                targetTiltX,
                0.06
            )
            tiltGroup.rotation.y = THREE.MathUtils.lerp(
                tiltGroup.rotation.y,
                targetTiltY,
                0.06
            )
            renderer.render(scene, camera)
        }
        animate()

        return () => {
            disposed = true
            cancelAnimationFrame(frameId)
            mount.removeEventListener("pointermove", handlePointerMove)
            pmremGenerator.dispose()
            renderer.dispose()
            if (renderer.domElement.parentNode === mount) {
                mount.removeChild(renderer.domElement)
            }
        }
    }, [coverImageUrl, width, height])

    return (
        <div
            ref={mountRef}
            style={{
                width,
                height,
                position: "relative",
                pointerEvents: "auto",
                cursor: "none",
            }}
        />
    )
}

function Film3DViewer({
    coverImageUrl,
    width,
    height,
}: {
    coverImageUrl: string
    width: number
    height: number
}) {
    const mountRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!coverImageUrl) return
        const mount = mountRef.current
        if (!mount) return

        const renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
        })
        renderer.setSize(width, height)
        renderer.setPixelRatio(window.devicePixelRatio)
        renderer.outputColorSpace = THREE.SRGBColorSpace
        renderer.toneMapping = THREE.ACESFilmicToneMapping
        renderer.toneMappingExposure = 1
        mount.appendChild(renderer.domElement)

        const scene = new THREE.Scene()
        const camera = new THREE.PerspectiveCamera(
            35,
            width / height,
            0.1,
            1000
        )

        const pmremGenerator = new THREE.PMREMGenerator(renderer)
        scene.environment = pmremGenerator.fromScene(
            createTiltEnvironment(),
            0.01
        ).texture

        const controls = new OrbitControls(camera, renderer.domElement)
        controls.enableDamping = true
        controls.enableRotate = false

        const key = new THREE.DirectionalLight(0xffffff, 1.5)
        key.position.set(3, 4, 5)
        scene.add(key)
        const fill = new THREE.DirectionalLight(0xffffff, 0.4)
        fill.position.set(-4, 2, 2)
        scene.add(fill)
        scene.add(new THREE.AmbientLight(0xffffff, 0.35))
        scene.add(camera)
        const cameraLight = new THREE.PointLight(0xffffff, 1.1)
        camera.add(cameraLight)

        const rig = new THREE.Group()
        scene.add(rig)
        rig.rotation.set(0, THREE.MathUtils.degToRad(45), 0)

        const tiltGroup = new THREE.Group()
        rig.add(tiltGroup)

        const FRONT_U_START = 0.525
        const FRONT_U_SPAN = 1 - FRONT_U_START
        const frontRepeatX = 1 / FRONT_U_SPAN
        const frontOffsetX = -FRONT_U_START / FRONT_U_SPAN

        let disposed = false
        const texLoader = new THREE.TextureLoader()
        texLoader.setCrossOrigin("anonymous")
        texLoader.load(coverImageUrl, (texture) => {
            if (disposed) return
            texture.colorSpace = THREE.SRGBColorSpace
            texture.flipY = false
            texture.anisotropy = renderer.capabilities.getMaxAnisotropy()
            texture.wrapS = THREE.ClampToEdgeWrapping
            texture.wrapT = THREE.ClampToEdgeWrapping
            texture.repeat.set(frontRepeatX, 1)
            texture.offset.set(frontOffsetX, 0)
            texture.needsUpdate = true

            loadDvdGltf()
                .then(({ scene: model }) => {
                    if (disposed) return

                    model.traverse((obj: any) => {
                        if (!obj.isMesh) return
                        const mats = Array.isArray(obj.material)
                            ? obj.material
                            : [obj.material]
                        if (obj.name === "Object_6") {
                            mats.forEach((m: any) => {
                                m.map = texture
                                m.color.set(0xffffff)
                                m.needsUpdate = true
                            })
                        }
                    })

                    const box = new THREE.Box3().setFromObject(model)
                    const center = box.getCenter(new THREE.Vector3())
                    model.position.sub(center)
                    tiltGroup.add(model)

                    const size = box.getSize(new THREE.Vector3())
                    const maxDim = Math.max(size.x, size.y, size.z)
                    const fitDist =
                        (maxDim /
                            (2 * Math.tan((camera.fov * Math.PI) / 360))) *
                        1.6
                    camera.position.set(
                        fitDist * 0.42,
                        -fitDist * 0.12,
                        fitDist * 0.92
                    )
                    camera.lookAt(0, 0, 0)
                    controls.target.set(0, 0, 0)
                    controls.update()
                })
                .catch((err) => console.error("GLTF load error", err))
        })

        const maxTilt = THREE.MathUtils.degToRad(25)
        let targetTiltX = 0
        let targetTiltY = 0
        const handlePointerMove = (e: PointerEvent) => {
            const rect = mount.getBoundingClientRect()
            const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1
            const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1
            targetTiltY = nx * maxTilt
            targetTiltX = -ny * maxTilt
        }
        mount.addEventListener("pointermove", handlePointerMove)

        let frameId: number
        const animate = () => {
            frameId = requestAnimationFrame(animate)
            controls.update()
            tiltGroup.rotation.x = THREE.MathUtils.lerp(
                tiltGroup.rotation.x,
                targetTiltX,
                0.06
            )
            tiltGroup.rotation.y = THREE.MathUtils.lerp(
                tiltGroup.rotation.y,
                targetTiltY,
                0.06
            )
            renderer.render(scene, camera)
        }
        animate()

        return () => {
            disposed = true
            cancelAnimationFrame(frameId)
            mount.removeEventListener("pointermove", handlePointerMove)
            pmremGenerator.dispose()
            renderer.dispose()
            if (renderer.domElement.parentNode === mount) {
                mount.removeChild(renderer.domElement)
            }
        }
    }, [coverImageUrl, width, height])

    return (
        <div
            ref={mountRef}
            style={{
                width,
                height,
                position: "relative",
                pointerEvents: "auto",
            }}
        />
    )
}

const DVD_CASE_WIDTH = 380
const DVD_CASE_HEIGHT = 540

const FILM_CASE_ASPECT = DVD_CASE_HEIGHT / DVD_CASE_WIDTH

function DVDCaseThumbnail({
    size,
    img,
    contrast = 100,
    spineWidth = 10,
    borderRadius = 6,
    textureImg,
    textureOpacity = 100,
    textureBlend = "screen",
    mirrored = false,
}: {
    size: number
    img?: string
    contrast?: number
    spineWidth?: number
    borderRadius?: number
    textureImg?: string
    textureOpacity?: number
    textureBlend?: string
    mirrored?: boolean
}) {
    const s = size / DVD_CASE_WIDTH
    const height = size * FILM_CASE_ASPECT
    const spinePx = spineWidth * s

    return (
        <div
            aria-hidden
            style={{
                position: "absolute",
                width: size,
                height,
                left: "50%",
                top: "50%",
                transform: "translate(-50%, -50%)",
                borderRadius: borderRadius * s,
                overflow: "hidden",
                background: "#050505",
            }}
        >
            {img && (
                <img
                    src={img}
                    alt=""
                    style={{
                        position: "absolute",
                        top: 8 * s,
                        bottom: 8 * s,
                        ...(mirrored
                            ? { right: 0, left: 10 * s }
                            : { left: 0, right: 10 * s }),
                        width: `calc(100% - ${10 * s}px)`,
                        height: `calc(100% - ${16 * s}px)`,
                        objectFit: "cover",
                        filter: `contrast(${contrast}%)`,
                    }}
                />
            )}

            <div
                style={{
                    position: "absolute",
                    ...(mirrored ? { right: 0 } : { left: 0 }),
                    top: 0,
                    bottom: 0,
                    width: spinePx,
                    background: mirrored
                        ? "linear-gradient(270deg, #050505 0%, #1a1a1a 45%, #0a0a0a 100%)"
                        : "linear-gradient(90deg, #050505 0%, #1a1a1a 45%, #0a0a0a 100%)",
                    boxShadow: mirrored
                        ? `inset ${1 * s}px 0 ${2 * s}px rgba(0,0,0,0.6)`
                        : `inset ${-1 * s}px 0 ${2 * s}px rgba(0,0,0,0.6)`,
                }}
            />

            <div
                style={{
                    position: "absolute",
                    ...(mirrored ? { right: spinePx } : { left: spinePx }),
                    top: 0,
                    bottom: 0,
                    width: 2 * s,
                    background: "rgba(0,0,0,0.55)",
                }}
            />

            {textureImg && (
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        backgroundImage: `url(${textureImg})`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                        mixBlendMode: textureBlend as any,
                        opacity: textureOpacity / 100,
                        pointerEvents: "none",
                    }}
                />
            )}

            <div
                aria-hidden
                style={{
                    position: "absolute",
                    inset: 0,
                    background:
                        "linear-gradient(115deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.02) 20%, transparent 40%)",
                    mixBlendMode: "screen",
                    pointerEvents: "none",
                }}
            />
        </div>
    )
}

function DVDCaseInner({
    size,
    img,
    contrast = 100,
}: {
    size: number
    img?: string
    contrast?: number
}) {
    const s = size / DVD_CASE_WIDTH
    const height = size * (DVD_CASE_HEIGHT / DVD_CASE_WIDTH)
    const discSize = 300 * s
    const ringSize = 308 * s
    const hubSize = 46 * s

    const sideTab = (top: number, side: "left" | "right") => (
        <div
            key={`${side}-${top}`}
            style={{
                position: "absolute",
                [side]: -2 * s,
                top: top * s,
                width: 22 * s,
                height: 34 * s,
                background:
                    "linear-gradient(180deg, #1c1c1c 0%, #0a0a0a 60%, #000 100%)",
                borderRadius:
                    side === "left"
                        ? `0 ${4 * s}px ${4 * s}px 0`
                        : `${4 * s}px 0 0 ${4 * s}px`,
                boxShadow: "inset 0 0 3px rgba(255,255,255,0.05)",
            }}
        />
    )

    return (
        <div
            style={{
                position: "relative",
                width: size,
                height,
                background:
                    "linear-gradient(155deg, #1a1a1a 0%, #101010 45%, #0c0c0c 100%)",
                borderRadius: 6 * s,
                overflow: "visible",
                boxShadow: `inset 0 0 0 ${1 * s}px rgba(255,255,255,0.04), 0 ${12 * s}px ${30 * s}px rgba(0,0,0,0.55)`,
            }}
        >
            <div
                style={{
                    position: "absolute",
                    inset: 0,
                    overflow: "hidden",
                    borderRadius: 6 * s,
                }}
            >
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        background:
                            "radial-gradient(ellipse at 30% 15%, rgba(255,255,255,0.06), transparent 55%)",
                        pointerEvents: "none",
                    }}
                />
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        background:
                            "radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(0,0,0,0.35) 100%)",
                        pointerEvents: "none",
                    }}
                />

                {[1.55, 1.3, 1.1].map((mult, i) => (
                    <div
                        key={i}
                        style={{
                            position: "absolute",
                            width: ringSize * mult,
                            height: ringSize * mult,
                            left: "50%",
                            top: "50%",
                            transform: "translate(-50%, -50%)",
                            borderRadius: "50%",
                            border: `${1 * s}px solid rgba(255,255,255,${0.025 + i * 0.01})`,
                            pointerEvents: "none",
                        }}
                    />
                ))}

                <div
                    style={{
                        position: "absolute",
                        left: "50%",
                        top: 0,
                        bottom: 0,
                        width: 16 * s,
                        transform: "translateX(-120%)",
                        background:
                            "linear-gradient(90deg, #050505 0%, #0e0e0e 50%, #050505 100%)",
                        boxShadow: "inset 0 0 6px rgba(0,0,0,0.7)",
                    }}
                />
                <div
                    style={{
                        position: "absolute",
                        left: "50%",
                        top: 0,
                        bottom: 0,
                        width: 3 * s,
                        transform: "translateX(-50%)",
                        background: "#020202",
                    }}
                />
                {[0.18, 0.5, 0.82].map((frac) => (
                    <div
                        key={frac}
                        style={{
                            position: "absolute",
                            left: "50%",
                            top: `${frac * 100}%`,
                            width: 8 * s,
                            height: 16 * s,
                            transform: "translate(-150%, -50%)",
                            background: "#020202",
                            borderRadius: 2 * s,
                        }}
                    />
                ))}

                <div
                    style={{
                        position: "absolute",
                        width: ringSize,
                        height: ringSize,
                        left: "50%",
                        top: "50%",
                        transform: "translate(-50%, -50%)",
                        borderRadius: "50%",
                        border: `${5 * s}px solid #060606`,
                        boxSizing: "border-box",
                        boxShadow: `inset 0 ${2 * s}px ${3 * s}px rgba(255,255,255,0.06), inset 0 ${-3 * s}px ${4 * s}px rgba(0,0,0,0.7), 0 ${1 * s}px ${2 * s}px rgba(0,0,0,0.4)`,
                    }}
                />
                <div
                    style={{
                        position: "absolute",
                        width: ringSize - 10 * s,
                        height: ringSize - 10 * s,
                        left: "50%",
                        top: "50%",
                        transform: "translate(-50%, -50%)",
                        borderRadius: "50%",
                        border: `${1 * s}px solid rgba(255,255,255,0.05)`,
                        pointerEvents: "none",
                    }}
                />

                <motion.div
                    animate={{ rotate: 360 }}
                    transition={{
                        duration: 2.5,
                        delay: 0.9,
                        repeat: Infinity,
                        repeatType: "loop",
                        ease: "linear",
                    }}
                    style={{
                        position: "absolute",
                        width: discSize,
                        height: discSize,
                        left: "50%",
                        top: "50%",
                        translateX: "-50%",
                        translateY: "-50%",
                        borderRadius: "50%",
                        overflow: "hidden",
                        boxShadow: `0 ${2 * s}px ${8 * s}px rgba(0,0,0,0.55)`,
                    }}
                >
                    {img && (
                        <div
                            style={{
                                position: "absolute",
                                inset: 0,
                                backgroundImage: `url(${img})`,
                                backgroundSize: "cover",
                                backgroundPosition: "center",
                                filter: `contrast(${contrast}%)`,
                            }}
                        />
                    )}
                    <div
                        style={{
                            position: "absolute",
                            inset: 0,
                            background:
                                "conic-gradient(from 200deg at 50% 50%, rgba(255,255,255,0.08), transparent 25%, transparent 65%, rgba(255,255,255,0.05))",
                            mixBlendMode: "overlay",
                        }}
                    />
                    <div
                        style={{
                            position: "absolute",
                            inset: 0,
                            borderRadius: "50%",
                            boxShadow: `inset 0 0 ${10 * s}px rgba(0,0,0,0.35)`,
                        }}
                    />
                </motion.div>

                <div
                    style={{
                        position: "absolute",
                        width: hubSize,
                        height: hubSize,
                        left: "50%",
                        top: "50%",
                        transform: "translate(-50%, -50%)",
                    }}
                >
                    <div
                        style={{
                            position: "absolute",
                            inset: 0,
                            borderRadius: "50%",
                            background:
                                "radial-gradient(circle at 35% 30%, #1c1c1c, #060606 70%)",
                            boxShadow: `inset 0 ${1 * s}px ${2 * s}px rgba(255,255,255,0.1), 0 ${1 * s}px ${3 * s}px rgba(0,0,0,0.5)`,
                        }}
                    />
                    {[0, 90, 180, 270].map((deg) => (
                        <div
                            key={deg}
                            style={{
                                position: "absolute",
                                left: "50%",
                                top: "50%",
                                width: hubSize * 0.44,
                                height: hubSize * 0.17,
                                background:
                                    "linear-gradient(90deg, #1a1a1a, #0a0a0a)",
                                borderRadius: 2 * s,
                                transform: `translate(-4%, -50%) rotate(${deg + 45}deg)`,
                                transformOrigin: "0% 50%",
                                boxShadow:
                                    "inset 0 1px 1px rgba(255,255,255,0.08)",
                            }}
                        />
                    ))}
                    <div
                        style={{
                            position: "absolute",
                            width: hubSize * 0.3,
                            height: hubSize * 0.3,
                            left: "50%",
                            top: "50%",
                            transform: "translate(-50%, -50%)",
                            borderRadius: "50%",
                            background: "#020202",
                            boxShadow: "inset 0 1px 1px rgba(0,0,0,0.8)",
                        }}
                    />
                </div>
            </div>

            {sideTab(70, "left")}
            {sideTab(230, "left")}
            {sideTab(400, "left")}
        </div>
    )
}

function DVDCaseFrontLid({
    size,
    img,
    contrast = 100,
}: {
    size: number
    img?: string
    contrast?: number
}) {
    const s = size / DVD_CASE_WIDTH
    const height = size * (DVD_CASE_HEIGHT / DVD_CASE_WIDTH)

    return (
        <div
            style={{
                position: "relative",
                width: size,
                height,
                transformStyle: "preserve-3d",
            }}
        >
            {/* Front face — cover art, hidden once flipped away from camera */}
            <div
                style={{
                    position: "absolute",
                    inset: 0,
                    borderRadius: 6 * s,
                    overflow: "hidden",
                    background: "#050505",
                    boxShadow: `0 ${12 * s}px ${30 * s}px rgba(0,0,0,0.55)`,
                    backfaceVisibility: "hidden",
                }}
            >
                {img && (
                    <img
                        src={img}
                        alt=""
                        style={{
                            position: "absolute",
                            inset: 0,
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                            filter: `contrast(${contrast}%)`,
                        }}
                    />
                )}
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        background:
                            "linear-gradient(115deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.04) 22%, transparent 45%)",
                        pointerEvents: "none",
                    }}
                />
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        background:
                            "radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(0,0,0,0.35) 100%)",
                        pointerEvents: "none",
                    }}
                />
                <div
                    style={{
                        position: "absolute",
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: 10 * s,
                        background:
                            "linear-gradient(90deg, rgba(0,0,0,0.55), transparent)",
                        pointerEvents: "none",
                    }}
                />
            </div>

            {/* Back face — blank interior plastic, only visible once the lid has swung past 90° */}
            <div
                style={{
                    position: "absolute",
                    inset: 0,
                    borderRadius: 6 * s,
                    overflow: "hidden",
                    background:
                        "linear-gradient(155deg, #1a1a1a 0%, #101010 45%, #0c0c0c 100%)",
                    boxShadow: `inset 0 0 0 ${1 * s}px rgba(255,255,255,0.04), 0 ${12 * s}px ${30 * s}px rgba(0,0,0,0.55)`,
                    backfaceVisibility: "hidden",
                    transform: "rotateY(180deg)",
                }}
            >
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        background:
                            "radial-gradient(ellipse at 70% 15%, rgba(255,255,255,0.06), transparent 55%)",
                        pointerEvents: "none",
                    }}
                />
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        background:
                            "radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(0,0,0,0.35) 100%)",
                        pointerEvents: "none",
                    }}
                />
            </div>
        </div>
    )
}

interface DirectoryHeaderProps {
    logoSrc?: string
    searchValue?: string
    categories: string[]
    activeCategory: string
    theme: "light" | "dark"
    onCategoryChange?: (c: string) => void
    onThemeChange?: (t: "light" | "dark") => void
    onSearch?: (v: string) => void
    onInfo?: () => void
    onNewEntry?: () => void
}

function DirectoryHeader({
    logoSrc,
    searchValue,
    categories,
    activeCategory,
    theme,
    onCategoryChange,
    onThemeChange,
    onSearch,
    onInfo,
    onNewEntry,
}: DirectoryHeaderProps) {
    const font = "'Spline Sans Mono', monospace"
    const pink = "#E298F2"
    const dark = "#1C1C1C"
    const white = "#FEFEFE"
    const panelBg =
        theme === "light"
            ? "rgba(28, 28, 28, 0.06)"
            : "rgba(254, 254, 254, 0.10)"

    const surfaceActive = theme === "light" ? dark : white
    const surfaceActiveText = theme === "light" ? white : dark
    const surfaceInactiveText = theme === "light" ? dark : white
    const searchColor =
        theme === "light" ? "rgba(28, 28, 28, 0.5)" : "rgba(254, 254, 254, 0.5)"
    const searchColorActive = theme === "light" ? dark : white
    const [searchFocused, setSearchFocused] = useState(false)
    const searchBorderColor =
        theme === "light"
            ? searchFocused
                ? "rgba(28, 28, 28, 1)"
                : "rgba(28, 28, 28, 0.3)"
            : searchFocused
              ? "rgba(254, 254, 254, 1)"
              : "rgba(254, 254, 254, 0.3)"

    const rowLabel = (
        label: string,
        active: boolean,
        onClick: (() => void) | undefined,
        icon: React.ReactNode,
        fontSize = 14
    ) => (
        <div
            onClick={() => {
                playClickSound()
                onClick?.()
            }}
            style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                padding: "8px 0px",
                gap: 8,
                width: "100%",
                height: 32,
                background: active ? surfaceActive : "transparent",
                cursor: onClick ? "pointer" : "default",
                flex: 1,
            }}
        >
            {icon}
            <span
                style={{
                    fontFamily: font,
                    fontWeight: 500,
                    fontSize,
                    lineHeight: `${Math.round(fontSize * 1.19)}px`,
                    color: active ? surfaceActiveText : surfaceInactiveText,
                    whiteSpace: "nowrap",
                }}
            >
                {label}
            </span>
        </div>
    )

    return (
        <div
            style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                zIndex: 10000,
                display: "flex",
                flexDirection: "row",
                alignItems: "flex-start",
                padding: "0px 8px",
                gap: 8,
                boxSizing: "border-box",
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "8px 0px",
                    flex: 1,
                    height: 60,
                }}
            >
                {logoSrc ? (
                    <img
                        src={logoSrc}
                        alt="Logo"
                        style={{
                            width: 488,
                            maxWidth: "100%",
                            height: 44,
                            objectFit: "contain",
                        }}
                    />
                ) : (
                    <span
                        style={{
                            fontFamily: font,
                            fontWeight: 600,
                            fontSize: 32,
                            letterSpacing: 2,
                            color: theme === "light" ? dark : white,
                            opacity: 0.9,
                        }}
                    >
                        THEE = MONOLITH
                    </span>
                )}
            </div>

            <div
                style={{
                    display: "flex",
                    flexDirection: "row",
                    flex: 1,
                    gap: 8,
                }}
            >
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                        flex: 1,
                    }}
                >
                    <div
                        style={{
                            boxSizing: "border-box",
                            display: "flex",
                            alignItems: "center",
                            padding: "42px 0px 6px",
                            gap: 8,
                            width: "100%",
                            height: 64,
                            background: panelBg,
                            borderBottom: `1px solid ${searchBorderColor}`,
                        }}
                    >
                        <Icon.Search color={searchColor} />
                        <input
                            placeholder="Search"
                            className="directory-search-input"
                            value={searchValue ?? ""}
                            onChange={(e) => onSearch?.(e.target.value)}
                            onFocus={() => setSearchFocused(true)}
                            onBlur={() => setSearchFocused(false)}
                            style={
                                {
                                    fontFamily: font,
                                    fontWeight: 500,
                                    fontSize: 14,
                                    lineHeight: "19px",
                                    color: searchFocused
                                        ? searchColorActive
                                        : searchColor,
                                    background: "transparent",
                                    border: "none",
                                    outline: "none",
                                    width: "100%",
                                    ["--placeholder-color" as any]: searchColor,
                                } as React.CSSProperties
                            }
                        />
                    </div>

                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            width: "100%",
                        }}
                    >
                        <div
                            style={{
                                display: "flex",
                                flexDirection: "row",
                                width: "100%",
                                height: 32,
                                background: panelBg,
                            }}
                        >
                            {categories.map((cat) => {
                                const active = cat === activeCategory
                                return (
                                    <div
                                        key={cat}
                                        style={{ display: "flex", flex: 1 }}
                                    >
                                        {rowLabel(
                                            cat,
                                            active,
                                            () => onCategoryChange?.(cat),
                                            <Icon.Caret
                                                color={
                                                    active
                                                        ? surfaceActiveText
                                                        : surfaceInactiveText
                                                }
                                                rotate={active ? 0 : -90}
                                            />
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                </div>

                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                        flex: 1,
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            width: "100%",
                        }}
                    >
                        <div
                            onClick={() => {
                                playClickSound()
                                onInfo?.()
                            }}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                padding: "8px 0px",
                                gap: 8,
                                width: "100%",
                                height: 32,
                                background: pink,
                                cursor: "pointer",
                            }}
                        >
                            <Icon.Plus color={dark} />
                            <span
                                style={{
                                    fontFamily: font,
                                    fontWeight: 500,
                                    fontSize: 14,
                                    color: dark,
                                }}
                            >
                                Info
                            </span>
                        </div>
                        <div
                            style={{
                                display: "flex",
                                flexDirection: "row",
                                width: "100%",
                                height: 32,
                                background: panelBg,
                            }}
                        >
                            <div style={{ display: "flex", flex: 1 }}>
                                {rowLabel(
                                    "Light",
                                    theme === "light",
                                    () => onThemeChange?.("light"),
                                    <Icon.Sun
                                        color={
                                            theme === "light"
                                                ? surfaceActiveText
                                                : surfaceInactiveText
                                        }
                                    />
                                )}
                            </div>
                            <div style={{ display: "flex", flex: 1 }}>
                                {rowLabel(
                                    "Dark",
                                    theme === "dark",
                                    () => onThemeChange?.("dark"),
                                    <Icon.Moon
                                        color={
                                            theme === "dark"
                                                ? surfaceActiveText
                                                : surfaceInactiveText
                                        }
                                    />
                                )}
                            </div>
                        </div>
                    </div>

                    <div
                        style={{
                            display: "flex",
                            flexDirection: "row",
                            width: "100%",
                            justifyContent: "flex-end",
                        }}
                    >
                        <div
                            onClick={() => {
                                playClickSound()
                                onNewEntry?.()
                            }}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                padding: "8px 0px",
                                gap: 8,
                                width: "50%",
                                height: 32,
                                background: pink,
                                cursor: "pointer",
                            }}
                        >
                            <Icon.Plus color={dark} />
                            <span
                                style={{
                                    fontFamily: font,
                                    fontWeight: 500,
                                    fontSize: 14,
                                    color: dark,
                                }}
                            >
                                New entry
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

function BottomToolbar({
    viewMode,
    onViewModeChange,
    onFilters,
    theme,
    filterCount = 0,
    onClearFilters,
}: {
    viewMode: "freeform" | "carousel"
    onViewModeChange: (v: "freeform" | "carousel") => void
    onFilters?: () => void
    theme: "light" | "dark"
    filterCount?: number
    onClearFilters?: () => void
}) {
    const font = "'Spline Sans Mono', monospace"
    const pink = "#E298F2"
    const dark = "#1C1C1C"
    const white = "#FEFEFE"
    const categoryInactiveBg =
        theme === "light"
            ? "rgba(28, 28, 28, 0.06)"
            : "rgba(254, 254, 254, 0.10)"
    const surfaceActive = theme === "light" ? dark : white
    const surfaceActiveText = theme === "light" ? white : dark
    const surfaceInactiveText = theme === "light" ? dark : white

    const tab = (label: string, value: "freeform" | "carousel") => {
        const active = viewMode === value
        return (
            <div
                onClick={() => {
                    playClickSound()
                    onViewModeChange(value)
                }}
                style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    padding: "4px 0px 12px",
                    gap: 8,
                    flex: 1,
                    height: 32,
                    background: active ? surfaceActive : categoryInactiveBg,
                    cursor: "pointer",
                    boxSizing: "border-box",
                }}
            >
                <span
                    style={{
                        fontFamily: font,
                        fontWeight: 500,
                        fontSize: 14,
                        lineHeight: "17px",
                        color: active ? surfaceActiveText : surfaceInactiveText,
                    }}
                >
                    {label}
                </span>
            </div>
        )
    }

    return (
        <div
            style={{
                position: "absolute",
                left: 8,
                bottom: 0,
                zIndex: 100,
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                height: 33,
            }}
        >
            <div
                style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    width: 231,
                    height: 32,
                    background: categoryInactiveBg,
                }}
            >
                {tab("Freeform", "freeform")}
                {tab("Carousel", "carousel")}
            </div>

            <div
                style={{
                    position: "relative",
                    display: "flex",
                    flexDirection: "column",
                }}
            >
                {filterCount > 0 && (
                    <div
                        onClick={() => {
                            playClickSound()
                            onClearFilters?.()
                        }}
                        style={{
                            position: "absolute",
                            bottom: "100%",
                            left: 0,
                            display: "flex",
                            flexDirection: "row",
                            alignItems: "flex-start",
                            padding: 0,
                            gap: 8,
                            width: "fit-content",
                            height: 20,
                            background: theme === "light" ? dark : white,
                            cursor: "pointer",
                        }}
                    >
                        <div
                            style={{
                                display: "flex",
                                flexDirection: "row",
                                justifyContent: "flex-end",
                                alignItems: "center",
                                padding: "6px 0px",
                                gap: 8,
                                height: 18,
                            }}
                        >
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    padding: 1,
                                    gap: 10,
                                    width: 18,
                                    height: 18,
                                    boxSizing: "border-box",
                                }}
                            >
                                <svg
                                    width="16"
                                    height="16"
                                    viewBox="0 0 16 16"
                                    fill="none"
                                >
                                    <path
                                        d="M13.0306 11.9695C13.1715 12.1104 13.2506 12.3015 13.2506 12.5007C13.2506 12.7 13.1715 12.8911 13.0306 13.032C12.8897 13.1729 12.6986 13.252 12.4993 13.252C12.3001 13.252 12.109 13.1729 11.9681 13.032L7.99997 9.06261L4.0306 13.0307C3.8897 13.1716 3.69861 13.2508 3.49935 13.2508C3.30009 13.2508 3.10899 13.1716 2.9681 13.0307C2.8272 12.8898 2.74805 12.6987 2.74805 12.4995C2.74805 12.3002 2.8272 12.1091 2.9681 11.9682L6.93747 8.00011L2.96935 4.03073C2.82845 3.88984 2.7493 3.69874 2.7493 3.49948C2.7493 3.30023 2.82845 3.10913 2.96935 2.96823C3.11024 2.82734 3.30134 2.74818 3.5006 2.74818C3.69986 2.74818 3.89095 2.82734 4.03185 2.96823L7.99997 6.93761L11.9693 2.96761C12.1102 2.82671 12.3013 2.74756 12.5006 2.74756C12.6999 2.74756 12.891 2.82671 13.0318 2.96761C13.1727 3.10851 13.2519 3.2996 13.2519 3.49886C13.2519 3.69812 13.1727 3.88921 13.0318 4.03011L9.06247 8.00011L13.0306 11.9695Z"
                                        fill={theme === "light" ? white : dark}
                                    />
                                </svg>
                            </div>
                            <span
                                style={{
                                    fontFamily: font,
                                    fontWeight: 500,
                                    fontSize: 14,
                                    lineHeight: "20px",
                                    color: theme === "light" ? white : dark,
                                }}
                            >
                                Clear
                            </span>
                        </div>
                    </div>
                )}
                <div
                    onClick={() => {
                        playClickSound()
                        onFilters?.()
                    }}
                    style={{
                        display: "flex",
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "4px 0px 13px",
                        gap: 8,
                        width: 230,
                        height: 33,
                        background: pink,
                        cursor: "pointer",
                        boxSizing: "border-box",
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 8,
                        }}
                    >
                        <Icon.Funnel color={dark} />
                        <span
                            style={{
                                fontFamily: font,
                                fontWeight: 500,
                                fontSize: 14,
                                lineHeight: "17px",
                                color: dark,
                            }}
                        >
                            Filters
                        </span>
                    </div>
                    {filterCount > 0 && (
                        <span
                            style={{
                                fontFamily: font,
                                fontWeight: 500,
                                fontSize: 14,
                                lineHeight: "17px",
                                color: dark,
                            }}
                        >
                            [{filterCount}]
                        </span>
                    )}
                </div>
            </div>
        </div>
    )
}

function IntroBanner({
    visible,
    onDismiss,
    theme,
}: {
    visible: boolean
    onDismiss: () => void
    theme: "light" | "dark"
}) {
    const font = "'Spline Sans Mono', monospace"
    const bannerBg = theme === "light" ? "#1C1C1C" : "#FEFEFE"
    const bannerText = theme === "light" ? "#FEFEFE" : "#1C1C1C"

    useEffect(() => {
        if (!visible) return
        const timer = window.setTimeout(() => {
            onDismiss()
        }, 5000)
        return () => clearTimeout(timer)
    }, [visible, onDismiss])

    return (
        <AnimatePresence>
            {visible && (
                <motion.div
                    initial={{ y: 40, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: 40, opacity: 0, transition: { delay: 0.2 } }}
                    transition={{
                        duration: 0.6,
                        delay: 0.9,
                        ease: [0.16, 1, 0.3, 1],
                    }}
                    style={{
    position: "absolute",
    right: 8,
    bottom: 0,
    display: "flex",
                        flexDirection: "row",
                        alignItems: "flex-start",
                        padding: "4px 0px",
                        gap: 24,
                        width: 464,
                        maxWidth: "calc(100% - 32px)",
                        background: bannerBg,
                        boxSizing: "border-box",
                        zIndex: 50,
                    }}
                >
                    <p
                        style={{
                            flex: 1,
                            margin: 0,
                            fontFamily: font,
                            fontWeight: 500,
                            fontSize: 14,
                            lineHeight: "22px",
                            color: bannerText,
                            display: "flex",
                            alignItems: "center",
                        }}
                    >
                        A dedicated space to show your personal favorites. See
                        what people like and share recommendations, no algorithm
                        needed.
                    </p>
                    <div
                        onClick={() => {
                            playClickSound()
                            onDismiss()
                        }}
                        style={{
                            width: 16,
                            height: 16,
                            flexShrink: 0,
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                        }}
                    >
                        <svg
                            width="16"
                            height="16"
                            viewBox="0 0 16 16"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                        >
                            <path
                                d="M13.0306 11.9695C13.1715 12.1104 13.2506 12.3015 13.2506 12.5007C13.2506 12.7 13.1715 12.8911 13.0306 13.032C12.8897 13.1729 12.6986 13.252 12.4993 13.252C12.3001 13.252 12.109 13.1729 11.9681 13.032L7.99997 9.06261L4.0306 13.0307C3.8897 13.1716 3.69861 13.2508 3.49935 13.2508C3.30009 13.2508 3.10899 13.1716 2.9681 13.0307C2.8272 12.8898 2.74805 12.6987 2.74805 12.4995C2.74805 12.3002 2.8272 12.1091 2.9681 11.9682L6.93747 8.00011L2.96935 4.03073C2.82845 3.88984 2.7493 3.69874 2.7493 3.49948C2.7493 3.30023 2.82845 3.10913 2.96935 2.96823C3.11024 2.82734 3.30134 2.74818 3.5006 2.74818C3.69986 2.74818 3.89095 2.82734 4.03185 2.96823L7.99997 6.93761L11.9693 2.96761C12.1102 2.82671 12.3013 2.74756 12.5006 2.74756C12.6999 2.74756 12.891 2.82671 13.0318 2.96761C13.1727 3.10851 13.2519 3.2996 13.2519 3.49886C13.2519 3.69812 13.1727 3.88921 13.0318 4.03011L9.06247 8.00011L13.0306 11.9695Z"
                                fill={bannerText}
                            />
                        </svg>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    )
}

// ─── EntryAddedToast ────────────────────────────────────────────────────────
interface ToastEntryData {
    entryId: string
    title: string
    creatorName: string
    coverImageUrl: string | null
    type: string
    genre?: string
    releaseYear?: number | null
}

function EntryAddedToast({
    entry,
    onClose,
    onUndo,
    theme,
    label = "New Entry Added",
}: {
    entry: ToastEntryData | null
    onClose: () => void
    onUndo?: () => void
    theme: "light" | "dark"
    label?: string
}) {
    const font = "'Spline Sans Mono', monospace"
    const pink = "#E298F2"
    const dark = "#1C1C1C"
    const white = "#FEFEFE"

    const cardBg = theme === "light" ? dark : white
    const cardTextColor = theme === "light" ? white : dark

    const textStackRef = useRef<HTMLDivElement>(null)
    const [imageSize, setImageSize] = useState(62)

    useEffect(() => {
        const el = textStackRef.current
        if (!el) return
        const update = () => setImageSize(el.offsetHeight || 62)
        update()
        const ro = new ResizeObserver(update)
        ro.observe(el)
        return () => ro.disconnect()
    }, [entry])

    useEffect(() => {
        if (!entry) return
        const timer = window.setTimeout(() => {
            onClose()
        }, 4500)
        return () => clearTimeout(timer)
    }, [entry, onClose])

    const chipTextStyle: React.CSSProperties = {
        fontFamily: font,
        fontWeight: 500,
        fontSize: 14,
        lineHeight: "17px",
        color: dark,
        display: "flex",
        alignItems: "center",
    }

    const plainChipTextStyle: React.CSSProperties = {
        ...chipTextStyle,
        color: cardTextColor,
    }

    return (
        <AnimatePresence>
            {entry && (
                <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 12 }}
                    transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                    style={{
                        position: "absolute",
                        left: 8,
                        bottom: 41,
                        zIndex: 10001,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-start",
                        width: 464,
                        maxWidth: "calc(100% - 16px)",
                    }}
                >
                    {/* Title pill */}
<div
    onClick={() => {
        playClickSound()
        onClose()
    }}
    style={{
        display: "flex",
        flexDirection: "row",
        justifyContent: "flex-end",
        alignItems: "center",
        gap: 8,
        width: "fit-content",
        background: pink,
        cursor: "pointer",
    }}
>
    <div
        style={{
            display: "flex",
            flexDirection: "row",
            justifyContent: "flex-end",
            alignItems: "flex-end",
            padding: "8px 0px",
        }}
    >
        <span style={chipTextStyle}>{label}</span>
    </div>
    <div
        style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 3,
            width: 22,
            height: 22,
            boxSizing: "border-box",
            cursor: "pointer",
        }}
    >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
                d="M13.0306 11.9695C13.1715 12.1104 13.2506 12.3015 13.2506 12.5007C13.2506 12.7 13.1715 12.8911 13.0306 13.032C12.8897 13.1729 12.6986 13.252 12.4993 13.252C12.3001 13.252 12.109 13.1729 11.9681 13.032L7.99997 9.06261L4.0306 13.0307C3.8897 13.1716 3.69861 13.2508 3.49935 13.2508C3.30009 13.2508 3.10899 13.1716 2.9681 13.0307C2.8272 12.8898 2.74805 12.6987 2.74805 12.4995C2.74805 12.3002 2.8272 12.1091 2.9681 11.9682L6.93747 8.00011L2.96935 4.03073C2.82845 3.88984 2.7493 3.69874 2.7493 3.49948C2.7493 3.30023 2.82845 3.10913 2.96935 2.96823C3.11024 2.82734 3.30134 2.74818 3.5006 2.74818C3.69986 2.74818 3.89095 2.82734 4.03185 2.96823L7.99997 6.93761L11.9693 2.96761C12.1102 2.82671 12.3013 2.74756 12.5006 2.74756C12.6999 2.74756 12.891 2.82671 13.0318 2.96761C13.1727 3.10851 13.2519 3.2996 13.2519 3.49886C13.2519 3.69812 13.1727 3.88921 13.0318 4.03011L9.06247 8.00011L13.0306 11.9695Z"
                fill={dark}
            />
        </svg>
    </div>
</div>

                    {/* Entry card */}
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "row",
                            alignItems: "stretch",
                            gap: 8,
                            width: 464,
                            maxWidth: "100%",
                            minHeight: 62,
                            background: cardBg,
                            boxSizing: "border-box",
                        }}
                    >
                        <div
                            style={{
                                width: imageSize,
                                height: imageSize,
                                flexShrink: 0,
                                backgroundImage: entry.coverImageUrl
                                    ? `url(${entry.coverImageUrl})`
                                    : undefined,
                                backgroundColor: entry.coverImageUrl
                                    ? undefined
                                    : theme === "light"
                                      ? "rgba(254, 254, 254, 0.1)"
                                      : "rgba(28, 28, 28, 0.1)",
                                backgroundSize: "cover",
                                backgroundPosition: "center",
                            }}
                        />
                        <div
    style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        flex: 1,
        minWidth: 0,
        gap: 8,
    }}
>
    <div
        ref={textStackRef}
        style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "flex-start",
            minWidth: 0,
        }}
    >
                            <div
                                style={{
                                    display: "flex",
                                    flexDirection: "row",
                                    alignItems: "center",
                                    padding: "4px 0px",
                                    background: cardBg,
                                    maxWidth: "100%",
                                }}
                            >
                                <span
                                    style={{
                                        ...plainChipTextStyle,
                                        whiteSpace: "nowrap",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                    }}
                                >
                                    {entry.title}
                                </span>
                            </div>
                            {entry.creatorName && (
                                <div
                                    style={{
                                        display: "flex",
                                        flexDirection: "row",
                                        alignItems: "center",
                                        padding: "4px 0px",
                                        background: cardBg,
                                        maxWidth: "100%",
                                    }}
                                >
                                    <span
                                        style={{
                                            ...plainChipTextStyle,
                                            whiteSpace: "nowrap",
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                        }}
                                    >
                                        {entry.creatorName}
                                    </span>
                                </div>
                            )}
                            <div
                                style={{
                                    display: "flex",
                                    flexDirection: "row",
                                    alignItems: "flex-start",
                                    gap: 8,
                                    background: cardBg,
                                }}
                            >
                                {entry.type && (
                                    <div
                                        style={{
                                            display: "flex",
                                            flexDirection: "row",
                                            alignItems: "center",
                                            padding: "4px 0px",
                                            background: cardBg,
                                        }}
                                    >
                                        <span style={plainChipTextStyle}>{entry.type}</span>
                                    </div>
                                )}
                                {entry.genre && (
                                    <div
                                        style={{
                                            display: "flex",
                                            flexDirection: "row",
                                            alignItems: "center",
                                            padding: "4px 0px",
                                            background: cardBg,
                                        }}
                                    >
                                        <span style={plainChipTextStyle}>{entry.genre}</span>
                                    </div>
                                )}
                                {entry.releaseYear && (
                                    <div
                                        style={{
                                            display: "flex",
                                            flexDirection: "row",
                                            alignItems: "center",
                                            padding: "4px 0px",
                                            background: cardBg,
                                        }}
                                    >
                                        <span style={plainChipTextStyle}>{entry.releaseYear}</span>
                                    </div>
                                )}
                            </div>
                            </div>

    {onUndo && (
        <div
            onClick={() => {
                playClickSound()
                onUndo()
            }}
            style={{
                ...plainChipTextStyle,
                textDecoration: "underline",
                cursor: "pointer",
                flexShrink: 0,
                paddingRight: 8,
            }}
        >
            Undo
        </div>
    )}
</div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    )
}

// ─── Carousel3D ─────────────────────────────────────────────────────────────
interface Carousel3DProps {
    images: ImageItem[]
    activeSearch?: boolean
    matchedEntryIds?: string[]
    rows?: number
    itemsPerRow?: number
    radius?: number
    columnSpacing?: number
    rowSpacing?: number
    perspective?: number
    tiltX?: number
    itemWidth?: number
    itemHeight?: number
    borderRadius?: number
    autoRotate?: boolean
    autoRotateSpeed?: number
    dragToRotate?: boolean
    dragSensitivity?: number
    edgeGap?: number
    spineDepth?: number
    spineTextEnabled?: boolean
    spineTextColor?: string
    spineFontSize?: number
    spineFontWeight?: number
    spineCreatorFontWeight?: number
    rotationPerItem?: number
    coverflowDepth?: number
    background?: string
    shadow?: boolean
    contrast?: number
    shadowIntensity?: number
    blurIntensity?: number
    noiseEnabled?: boolean
    noiseOpacity?: number
    noiseSize?: number
    noiseBlend?: string
    musicTextureImg?: string
    musicTextureOpacity?: number
    musicTextureBlend?: string
    filmItemWidth?: number
    filmItemHeight?: number
    filmSpineDepth?: number
    filmEdgeGap?: number
    filmSpineTextEnabled?: boolean
    filmSpineTextColor?: string
    filmSpineFontSize?: number
    filmSpineFontWeight?: number
    filmSpineCreatorFontWeight?: number
    filmTextureImg?: string
    filmTextureOpacity?: number
    filmTextureBlend?: string
    bookItemWidth?: number
    bookSpineDepth?: number
    bookEdgeGap?: number
    bookSpineTextEnabled?: boolean
    bookSpineTextColor?: string
    bookSpineFontSize?: number
    bookSpineFontWeight?: number
    bookSpineCreatorFontWeight?: number
    holeSize?: number
    bookWidth?: number
    spineWidth?: number
    bookBorderRadius?: number
    textureBlend?: string
    filmWidth?: number
    filmSpineWidth?: number
    filmBorderRadius?: number
    textureImg?: string
    textureOpacity?: number
    showInfoOnHover?: boolean
    infoTextColor?: string
    infoFontSize?: number
    infoBgColor?: string
    infoBgTextColor?: string
    activeCategory?: string
    paused?: boolean
    onItemHoverChange?: (hovering: boolean) => void
    onItemSelect?: (entryId: string | undefined) => void
}

function Carousel3D({
    images,
    activeSearch = false,
    matchedEntryIds = [],
    rows = 4,
    itemsPerRow = 9,
    radius = 320,
    columnSpacing = 0,
    rowSpacing = 220,
    perspective = 1200,
    tiltX = 0,
    itemWidth = 280,
    itemHeight = 360,
    borderRadius = 14,
    autoRotate = false,
    autoRotateSpeed = 6,
    dragToRotate = true,
    dragSensitivity = 0.4,
    edgeGap = 12,
    spineDepth = 28,
    spineTextEnabled = true,
    spineTextColor = "auto",
    spineFontSize = 11,
    spineFontWeight = 600,
    spineCreatorFontWeight = 400,
    rotationPerItem = 65,
    coverflowDepth = 80,
    background = "transparent",
    shadow = true,
    contrast = 100,
    shadowIntensity = 0,
    blurIntensity = 12,
    noiseEnabled = false,
    noiseOpacity = 18,
    noiseSize = 180,
    noiseBlend = "overlay",
    musicTextureImg,
    musicTextureOpacity = 100,
    musicTextureBlend = "screen",
    filmItemWidth,
    filmItemHeight,
    filmSpineDepth,
    filmEdgeGap,
    filmSpineTextEnabled,
    filmSpineTextColor,
    filmSpineFontSize,
    filmSpineFontWeight,
    filmSpineCreatorFontWeight,
    filmTextureImg,
    filmTextureOpacity = 100,
    filmTextureBlend = "screen",
    bookItemWidth,
    bookSpineDepth,
    bookEdgeGap,
    bookSpineTextEnabled,
    bookSpineTextColor,
    bookSpineFontSize,
    bookSpineFontWeight,
    bookSpineCreatorFontWeight,
    holeSize = 14,
    bookWidth = 770,
    spineWidth = 36,
    bookBorderRadius = 4,
    textureBlend = "screen",
    filmWidth = 320,
    filmSpineWidth = 10,
    filmBorderRadius = 6,
    textureImg,
    textureOpacity = 100,
    showInfoOnHover = true,
    infoTextColor = "#1C1C1C",
    infoFontSize = 16,
    infoBgColor = "#FEFEFE",
    infoBgTextColor = "#1C1C1C",
    activeCategory = "Music",
    paused = false,
    onItemHoverChange,
    onItemSelect,
}: Carousel3DProps) {
    const isFilm = activeCategory === "Film"
    const isBook = activeCategory === "Books"

    const effItemWidth = isFilm
        ? (filmItemWidth ?? itemWidth)
        : isBook
          ? (bookItemWidth ?? itemWidth)
          : itemWidth

    const effItemHeight = isFilm
        ? effItemWidth * FILM_CASE_ASPECT
        : isBook
          ? effItemWidth * BOOK_ASPECT
          : itemHeight

    const effEdgeGap = isFilm
        ? (filmEdgeGap ?? edgeGap)
        : isBook
          ? (bookEdgeGap ?? edgeGap)
          : edgeGap

    const effSpineDepth = isFilm
        ? (filmSpineDepth ?? spineDepth)
        : isBook
          ? (bookSpineDepth ?? spineDepth)
          : spineDepth

    const effSpineTextEnabled = isBook
        ? bookSpineTextEnabled !== undefined
            ? bookSpineTextEnabled
            : spineTextEnabled
        : false

    const effSpineTextColor = isFilm
        ? (filmSpineTextColor ?? spineTextColor)
        : isBook
          ? (bookSpineTextColor ?? spineTextColor)
          : spineTextColor

    const effSpineFontSize = isFilm
        ? (filmSpineFontSize ?? spineFontSize)
        : isBook
          ? (bookSpineFontSize ?? spineFontSize)
          : spineFontSize

    const effSpineFontWeight = isFilm
        ? (filmSpineFontWeight ?? spineFontWeight)
        : isBook
          ? (bookSpineFontWeight ?? spineFontWeight)
          : spineFontWeight

    const effSpineCreatorFontWeight = isFilm
        ? (filmSpineCreatorFontWeight ?? spineCreatorFontWeight)
        : isBook
          ? (bookSpineCreatorFontWeight ?? spineCreatorFontWeight)
          : spineCreatorFontWeight
    const isOverActionButtonRef = useRef(false)
    const matchedEntryIdSet = useMemo(
        () => new Set(matchedEntryIds),
        [matchedEntryIds]
    )

    const [spineColors, setSpineColors] = useState<Record<string, string>>({})

    useEffect(() => {
        let cancelled = false
        images.forEach((img) => {
            if (!img.src || spineColors[img.src]) return
            getDominantColorForSpine(img.src).then((color) => {
                if (!cancelled)
                    setSpineColors((prev) => ({ ...prev, [img.src]: color }))
            })
        })
        return () => {
            cancelled = true
        }
    }, [images])

    const [filmSpineColors, setFilmSpineColors] = useState<Record<string, string>>({})
    const [musicSpineEdgeColors, setMusicSpineEdgeColors] = useState<Record<string, string>>({})

    useEffect(() => {
        if (!isFilm) return
        let cancelled = false
        const fraction = Math.min(
            0.3,
            Math.max(0.05, effSpineDepth / effItemWidth)
        )
        images.forEach((img) => {
            if (!img.src) return
            const key = `${img.src}::${fraction.toFixed(3)}`
            if (filmSpineColors[key]) return
            getDominantColorForFilmSpine(img.src, fraction).then((color) => {
                if (!cancelled)
                    setFilmSpineColors((prev) => ({ ...prev, [key]: color }))
            })
        })
        return () => {
            cancelled = true
        }
    }, [images, isFilm, effSpineDepth, effItemWidth])

    const [bookCoverTones, setBookCoverTones] = useState<Record<string, { light: string; dark: string }>>({})

useEffect(() => {
    if (!isBook) return
    let cancelled = false
    images.forEach((img) => {
        if (!img.src || bookCoverTones[img.src]) return
        getCoverLightDarkColors(img.src).then((tones) => {
            if (!cancelled) setBookCoverTones((prev) => ({ ...prev, [img.src]: tones }))
        })
    })
    return () => { cancelled = true }
}, [images, isBook])

    useEffect(() => {
        if (isFilm || isBook) return
        let cancelled = false
        const fraction = Math.min(
            0.3,
            Math.max(0.05, effSpineDepth / effItemWidth)
        )
        images.forEach((img) => {
            if (!img.src) return
            const key = `${img.src}::${fraction.toFixed(3)}`
            if (musicSpineEdgeColors[key]) return
            getDominantColorForFilmSpine(img.src, fraction).then((color) => {
                if (!cancelled)
                    setMusicSpineEdgeColors((prev) => ({
                        ...prev,
                        [key]: color,
                    }))
            })
        })
        return () => {
            cancelled = true
        }
    }, [images, isFilm, isBook, effSpineDepth, effItemWidth])

    const itemCountSafe = Math.max(images.length, 1)
    const itemSpacing = effItemWidth + effEdgeGap
    const singleWidthPx = Math.max(itemCountSafe * itemSpacing, 1)

    const [viewportWidth, setViewportWidth] = useState(1600)
    useEffect(() => {
        const el = wheelContainerRef.current
        if (!el) return
        const update = () => setViewportWidth(el.offsetWidth || 1600)
        update()
        const ro = new ResizeObserver(update)
        ro.observe(el)
        return () => ro.disconnect()
    }, [])
    const neededSpan = viewportWidth * 3
    const repeatCount = Math.min(
        21,
        Math.max(3, Math.ceil(neededSpan / singleWidthPx))
    )
    const totalUnits = itemCountSafe * repeatCount
    const startUnit = -Math.floor(totalUnits / 2)

    const slots = useMemo(() => {
        const list: { u: number; img: ImageItem | undefined }[] = []
        for (let i = 0; i < totalUnits; i++) {
            const u = startUnit + i
            const idx =
                itemCountSafe > 0
                    ? ((u % itemCountSafe) + itemCountSafe) % itemCountSafe
                    : 0
            list.push({ u, img: images[idx] })
        }
        return list
    }, [totalUnits, startUnit, itemCountSafe, images])

    const offsetRef = useRef(0)
    const velocity = useRef(0)
    const itemRefs = useRef<(HTMLDivElement | null)[]>([])
    const dragging = useRef(false)
    const lastX = useRef(0)
    const dragDistance = useRef(0)
    const clickCandidateRef = useRef<string | undefined>(undefined)
    const rafRef = useRef<number | undefined>(undefined)
    const isHoveringRef = useRef(false)
    const pausedRef = useRef(paused)
    useEffect(() => {
        pausedRef.current = paused
    }, [paused])

    const hoveredSlotIndexRef = useRef<number | null>(null)
    const pullProgressRef = useRef(0)

    const [frontCol, setFrontCol] = useState(0)
    const frontColRef = useRef(0)
    const [infoDirection, setInfoDirection] = useState(1)

    useEffect(() => {
        isOverActionButtonRef.current = false
    }, [frontCol])

    const applyTransform = useCallback(() => {
        const raw = offsetRef.current
        const wrapped = raw - itemCountSafe * Math.round(raw / itemCountSafe)
        let nearestIdx = 0
        let nearestDist = Infinity

        slots.forEach((slot, i) => {
            const el = itemRefs.current[i]
            if (!el) return
            const distanceItems = slot.u - wrapped
            const relativePx = distanceItems * itemSpacing
            const flipFactor = Math.tanh(distanceItems * 2.2)
            const angle = 90 - flipFactor * rotationPerItem
            const angleRad = (angle * Math.PI) / 180
            const depth = -Math.abs(Math.sin(angleRad)) * coverflowDepth
            const zIndex = Math.round(Math.cos(angleRad) * 1000)
            const isHoveredSlot = i === hoveredSlotIndexRef.current
            const rawPull = isHoveredSlot ? pullProgressRef.current : 0
            const easedPull =
                rawPull < 0.5
                    ? 4 * rawPull * rawPull * rawPull
                    : 1 - Math.pow(-2 * rawPull + 2, 3) / 2
            const pulledDepth = depth + easedPull * 60
            const pulledScale = 1 + easedPull * 0.06

            el.style.transform = `translateX(${relativePx}px) translateZ(${pulledDepth}px) rotateY(${angle}deg) scale(${pulledScale})`
            el.style.zIndex = String(isHoveredSlot ? 9999 : zIndex)
            if (Math.abs(distanceItems) < nearestDist) {
                nearestDist = Math.abs(distanceItems)
                nearestIdx =
                    ((slot.u % itemCountSafe) + itemCountSafe) % itemCountSafe
            }
        })

        if (nearestIdx !== frontColRef.current) {
            frontColRef.current = nearestIdx
            setFrontCol(nearestIdx)
        }
    }, [itemCountSafe, itemSpacing, rotationPerItem, coverflowDepth, slots])

    useEffect(() => {
        applyTransform()
    }, [applyTransform])

    useEffect(() => {
        let last = performance.now()
        const tick = (now: number) => {
            const dt = Math.min((now - last) / 1000, 0.05)
            last = now

            if (dragging.current) {
                // rotation is set directly in the pointer handler
            } else if (Math.abs(velocity.current) > 0.5) {
                offsetRef.current += (velocity.current / itemSpacing) * dt
                velocity.current *= 0.92
                applyTransform()
            } else if (autoRotate && !pausedRef.current) {
                const speed = isHoveringRef.current
                    ? autoRotateSpeed * 0.3
                    : autoRotateSpeed
                offsetRef.current += (speed / itemSpacing) * dt
                applyTransform()
            }
            const target = hoveredSlotIndexRef.current !== null ? 1 : 0
            if (Math.abs(pullProgressRef.current - target) > 0.001) {
                const lerpSpeed = target === 1 ? 0.09 : 0.12
                pullProgressRef.current +=
                    (target - pullProgressRef.current) * lerpSpeed
                applyTransform()
            }

            rafRef.current = requestAnimationFrame(tick)
        }
        rafRef.current = requestAnimationFrame(tick)
        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current)
        }
    }, [autoRotate, autoRotateSpeed, applyTransform])

    const dragSensitivityRef = useRef(dragSensitivity)
    useEffect(() => {
        dragSensitivityRef.current = dragSensitivity
    }, [dragSensitivity])

    const wheelContainerRef = useRef<HTMLDivElement | null>(null)
    useEffect(() => {
        const el = wheelContainerRef.current
        if (!el) return
        const handleWheel = (e: WheelEvent) => {
            e.preventDefault()
            const delta = (e.deltaX + e.deltaY) * dragSensitivityRef.current
            offsetRef.current += delta / itemSpacing
            velocity.current = velocity.current * 0.7 + delta * 6 * 0.3
            applyTransform()
        }
        el.addEventListener("wheel", handleWheel, { passive: false })
        return () => el.removeEventListener("wheel", handleWheel)
    }, [applyTransform])

    const onPointerDown = (e: React.PointerEvent) => {
        if (!dragToRotate) return
        e.preventDefault()
        dragging.current = true
        dragDistance.current = 0
        velocity.current = 0
        lastX.current = e.clientX
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    }

    const onPointerMove = (e: React.PointerEvent) => {
        if (!dragging.current) return
        const dx = e.clientX - lastX.current
        lastX.current = e.clientX
        dragDistance.current += Math.abs(dx)
        const delta = -dx * dragSensitivity
        offsetRef.current += delta / itemSpacing
        velocity.current = delta * 60
        applyTransform()
    }

    const onPointerUp = () => {
        dragging.current = false
        if (
            dragDistance.current <= CLICK_THRESHOLD &&
            clickCandidateRef.current
        ) {
            onItemSelect?.(clickCandidateRef.current)
        }
        clickCandidateRef.current = undefined
    }

    const noiseBg = makeNoiseSvg(noiseSize)

    const infoVariants = {
        enter: (direction: number) => ({
            opacity: 0,
            x: direction > 0 ? 16 : -16,
        }),
        center: { opacity: 1, x: 0 },
        exit: (direction: number) => ({
            opacity: 0,
            x: direction > 0 ? -16 : 16,
        }),
    }

    const centeredSlot = images[frontCol]
    const mutedInfoTextColor =
    infoBgColor === "#FEFEFE"
        ? "rgba(254,254,254,0.55)"
        : "rgba(28,28,28,0.55)"

    return (
        <div
            ref={wheelContainerRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerEnter={() => {
                isHoveringRef.current = true
            }}
            onPointerLeave={() => {
                isHoveringRef.current = false
                isOverActionButtonRef.current = false
            }}
            style={{
                width: "100%",
                height: "100%",
                background,
                overflow: "hidden",
                position: "relative",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                perspective: `${perspective}px`,
                touchAction: dragToRotate ? "none" : "auto",
                cursor: dragToRotate ? "grab" : "default",
                userSelect: "none",
                WebkitUserSelect: "none",
            }}
            onDragStart={(e) => e.preventDefault()}
        >
            <div
                style={{
                    position: "relative",
                    width: effItemWidth,
                    height: effItemHeight,
                    transformStyle: "preserve-3d",
                    transform: `rotateX(${tiltX}deg) rotateY(0deg)`,
                }}
            >
                {slots.map((slot, i) => {
                    const img = slot.img
                    const isMatched =
                        !activeSearch ||
                        (!!img?.entryId && matchedEntryIdSet.has(img.entryId))

                    return (
                        <div
                            key={i}
                            ref={(el) => {
                                itemRefs.current[i] = el
                            }}
                            onPointerDown={() => {
                                if (!isMatched) return
                                clickCandidateRef.current = img?.entryId
                            }}
                            onMouseEnter={() => {
                                if (!isMatched) return
                                hoveredSlotIndexRef.current = i
                                if (!isOverActionButtonRef.current)
                                    onItemHoverChange?.(true)
                            }}
                            onMouseLeave={() => {
                                if (hoveredSlotIndexRef.current === i)
                                    hoveredSlotIndexRef.current = null
                                onItemHoverChange?.(false)
                            }}
                            aria-label={img?.alt ?? ""}
                            aria-disabled={!isMatched}
                            style={{
                                position: "absolute",
                                top: "50%",
                                left: "50%",
                                width: effItemWidth,
                                height: effItemHeight,
                                marginLeft: -effItemWidth / 2,
                                marginTop: -effItemHeight / 2,
                                transformStyle: "preserve-3d",
                                willChange: "transform",
                                cursor: isMatched ? "none" : "default",
                            }}
                        >
                            {/* FRONT FACE */}
                            <div
                                style={{
                                    position: "absolute",
                                    inset: 0,
                                    backfaceVisibility: "hidden",
                                    WebkitBackfaceVisibility: "hidden",
                                    transform: `translateZ(${effSpineDepth / 2}px)`,
                                    ...(activeCategory !== "Books" &&
                                        activeCategory !== "Film" && {
                                            borderRadius,
                                        }),
                                    overflow:
                                        activeCategory === "Books" ||
                                        activeCategory === "Film"
                                            ? "visible"
                                            : "hidden",
                                    filter: isMatched
                                        ? "blur(0px) saturate(1) grayscale(0)"
                                        : `blur(${blurIntensity}px) saturate(0.35) grayscale(1)`,
                                    opacity: isMatched ? 1 : 0.18,
                                    transition:
                                        "filter 0.35s cubic-bezier(0.4,0,0.2,1), opacity 0.35s cubic-bezier(0.4,0,0.2,1)",
                                }}
                            >
                                {activeCategory === "Film"
                                    ? img?.src && (
                                          <DVDCaseThumbnail
                                              size={effItemWidth}
                                              img={img.src}
                                              contrast={contrast}
                                              spineWidth={filmSpineWidth}
                                              borderRadius={filmBorderRadius}
                                              textureImg={filmTextureImg}
                                              textureOpacity={
                                                  filmTextureOpacity
                                              }
                                              textureBlend={filmTextureBlend}
                                          />
                                      )
                                    : activeCategory === "Books"
                                      ? img?.src && (
                                            <BookCover
                                                size={effItemWidth}
                                                img={img.src}
                                                contrast={contrast}
                                                spineWidth={spineWidth}
                                                borderRadius={bookBorderRadius}
                                                textureImg={textureImg}
                                                textureOpacity={textureOpacity}
                                                textureBlend={textureBlend}
                                            />
                                        )
                                      : img?.src && (
                                            <VinylSleeve
                                                size={Math.min(
                                                    effItemWidth,
                                                    effItemHeight
                                                )}
                                                img={img.src}
                                                contrast={contrast}
                                                borderRadius={borderRadius}
                                                shadowIntensity={
                                                    shadowIntensity
                                                }
                                                noiseEnabled={noiseEnabled}
                                                noiseSize={noiseSize}
                                                noiseOpacity={noiseOpacity}
                                                noiseBlend={noiseBlend}
                                                textureImg={musicTextureImg}
                                                textureOpacity={
                                                    musicTextureOpacity
                                                }
                                                textureBlend={musicTextureBlend}
                                            />
                                        )}
                            </div>

                            {/* BACK FACE */}
                            <div
                                style={{
                                    position: "absolute",
                                    inset: 0,
                                    borderRadius:
                                        activeCategory !== "Books"
                                            ? borderRadius
                                            : 0,
                                    overflow:
                                        activeCategory === "Film" ||
                                        activeCategory === "Books"
                                            ? "visible"
                                            : "hidden",
                                    backgroundColor: "#111",
                                    backgroundImage:
                                        activeCategory === "Film" ||
                                        activeCategory === "Books"
                                            ? undefined
                                            : img?.src
                                              ? `url(${img.src})`
                                              : undefined,
                                    backgroundSize: "cover",
                                    backgroundPosition: "center",
                                    backfaceVisibility: "hidden",
                                    WebkitBackfaceVisibility: "hidden",
                                    transform: `rotateY(180deg) translateZ(${effSpineDepth / 2}px)`,
                                    filter: isMatched
                                        ? "blur(0px) saturate(1) grayscale(0)"
                                        : `blur(${blurIntensity}px) saturate(0.35) grayscale(1)`,
                                    opacity: isMatched ? 1 : 0.18,
                                    transition:
                                        "filter 0.35s cubic-bezier(0.4,0,0.2,1), opacity 0.35s cubic-bezier(0.4,0,0.2,1)",
                                }}
                            >
                                {activeCategory === "Film" ? (
                                    img?.src && (
                                        <DVDCaseThumbnail
                                            size={effItemWidth}
                                            img={img.src}
                                            contrast={contrast}
                                            spineWidth={filmSpineWidth}
                                            borderRadius={filmBorderRadius}
                                            textureImg={filmTextureImg}
                                            textureOpacity={filmTextureOpacity}
                                            textureBlend={filmTextureBlend}
                                            mirrored
                                        />
                                    )
                                ) : activeCategory === "Books" ? (
                                    img?.src && (
                                        <BookCover
                                            size={effItemWidth}
                                            img={img.src}
                                            contrast={contrast}
                                            spineWidth={spineWidth}
                                            borderRadius={bookBorderRadius}
                                            textureImg={textureImg}
                                            textureOpacity={textureOpacity}
                                            textureBlend={textureBlend}
                                            mirrored
                                        />
                                    )
                                ) : (
                                    <>
                                        <div
                                            style={{
                                                position: "absolute",
                                                inset: 0,
                                                background: "rgba(0,0,0,0.35)",
                                            }}
                                        />
                                        {musicTextureImg && (
                                            <div
                                                style={{
                                                    position: "absolute",
                                                    inset: 0,
                                                    backgroundImage: `url(${musicTextureImg})`,
                                                    backgroundSize: "cover",
                                                    backgroundPosition:
                                                        "center",
                                                    mixBlendMode:
                                                        musicTextureBlend as any,
                                                    opacity:
                                                        musicTextureOpacity /
                                                        100,
                                                    pointerEvents: "none",
                                                }}
                                            />
                                        )}
                                    </>
                                )}
                            </div>

                            {/* SPINE FACE */}
                            <div
                                style={{
                                    position: "absolute",
                                    top: "50%",
                                    left: "50%",
                                    width: effSpineDepth,
                                    height: effItemHeight,
                                    marginLeft: -effSpineDepth / 2,
                                    marginTop: -effItemHeight / 2,
                                    overflow: "hidden",
                                    borderRadius:
                                        isFilm || isBook
                                            ? `${Math.min(effSpineDepth * 0.35, 4)}px / 6px`
                                            : 0,
                                    backgroundColor: isFilm
                                        ? img?.src
                                            ? filmSpineColors[
                                                  `${img.src}::${Math.min(0.3, Math.max(0.05, effSpineDepth / effItemWidth)).toFixed(3)}`
                                              ] || "#0c0c0c"
                                            : "#0c0c0c"
                                        : img?.src
                                          ? spineColors[img.src] || "#0c0c0c"
                                          : "#0c0c0c",
                                    backfaceVisibility: "hidden",
                                    WebkitBackfaceVisibility: "hidden",
                                    transform: `rotateY(-90deg) translateZ(${effItemWidth / 2}px)`,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    filter: isMatched
                                        ? "blur(0px) saturate(1) grayscale(0)"
                                        : `blur(${blurIntensity}px) saturate(0.35) grayscale(1)`,
                                    opacity: isMatched ? 1 : 0.18,
                                    transition:
                                        "filter 0.35s cubic-bezier(0.4,0,0.2,1), opacity 0.35s cubic-bezier(0.4,0,0.2,1)",
                                }}
                            >
                                {isFilm && img?.src && (
                                    <div
                                        style={{
                                            position: "absolute",
                                            left: 0,
                                            right: 0,
                                            top:
                                                8 *
                                                (effItemWidth / DVD_CASE_WIDTH),
                                            bottom:
                                                8 *
                                                (effItemWidth / DVD_CASE_WIDTH),
                                            backgroundImage: `url(${img.src})`,
                                            backgroundSize: `${effItemWidth}px ${effItemHeight - 2 * (8 * (effItemWidth / DVD_CASE_WIDTH))}px`,
                                            backgroundPosition: "left center",
                                            backgroundRepeat: "no-repeat",
                                        }}
                                    />
                                )}
                                {!isFilm && !isBook && img?.src && (
                                    <div
                                        style={{
                                            position: "absolute",
                                            inset: 0,
                                            backgroundImage: `url(${img.src})`,
                                            backgroundSize: `${effItemWidth}px ${effItemHeight}px`,
                                            backgroundPosition: "left center",
                                            backgroundRepeat: "no-repeat",
                                        }}
                                    />
                                )}
                                <div
                                    style={{
                                        position: "absolute",
                                        inset: 0,
                                        background: "rgba(0,0,0,0.15)",
                                    }}
                                />
                                {isBook && textureImg && (
                                    <div
                                        style={{
                                            position: "absolute",
                                            inset: 0,
                                            backgroundImage: `url(${textureImg})`,
                                            backgroundSize: "cover",
                                            backgroundPosition: "center",
                                            mixBlendMode: textureBlend as any,
                                            opacity: textureOpacity / 100,
                                            pointerEvents: "none",
                                        }}
                                    />
                                )}
                                {effSpineTextEnabled &&
                                    img?.title &&
                                    (() => {
                                        const fraction = Math.min(
                                            0.3,
                                            Math.max(
                                                0.05,
                                                effSpineDepth / effItemWidth
                                            )
                                        )
                                        const spineBg = isFilm
    ? img?.src
        ? filmSpineColors[`${img.src}::${fraction.toFixed(3)}`]
        : undefined
    : img?.src
      ? spineColors[img.src]  // whole-cover dominant color — same value used as the spine's actual background
      : undefined

const effectiveTextColor =
    isBook && img?.src && spineBg && bookCoverTones[img.src]
        ? pickCoverTextColor(
              bookCoverTones[img.src].light,
              bookCoverTones[img.src].dark,
              spineBg
          )
        : spineBg
          ? getContrastingSpineTextColor(spineBg)
          : "rgba(254,254,254,0.95)"
                                        const SUPERSAMPLE = 4
                                        const baseTextStyle: React.CSSProperties =
                                            {
                                                fontFamily:
                                                    "'Spline Sans', sans-serif",
                                                fontSize:
                                                    effSpineFontSize *
                                                    SUPERSAMPLE,
                                                letterSpacing: 1 * SUPERSAMPLE,
                                                textTransform: "uppercase",
                                                whiteSpace: "nowrap",
                                                WebkitFontSmoothing:
                                                    "antialiased",
                                                textRendering:
                                                    "optimizeLegibility",
                                                textShadow:
                                                    "0 0 0 currentColor",
                                            }
                                        return (
                                            <div
                                                style={{
                                                    position: "relative",
                                                    zIndex: 1,
                                                    width: "100%",
                                                    height: "100%",
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                    overflow: "hidden",
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        writingMode:
                                                            "vertical-rl",
                                                        textOrientation:
                                                            "mixed",
                                                        color: effectiveTextColor,
                                                        textAlign: "center",
                                                        transform: `scale(${1 / SUPERSAMPLE})`,
                                                        transformOrigin:
                                                            "center",
                                                        backfaceVisibility:
                                                            "hidden",
                                                        display: "flex",
                                                        alignItems: "center",
                                                        gap: 6 * SUPERSAMPLE,
                                                    }}
                                                >
                                                    <span
                                                        style={{
                                                            ...baseTextStyle,
                                                            fontWeight:
                                                                effSpineFontWeight,
                                                        }}
                                                    >
                                                        {img.title}
                                                    </span>
                                                    {img.creatorName && (
                                                        <span
                                                            style={{
                                                                ...baseTextStyle,
                                                                fontWeight:
                                                                    effSpineCreatorFontWeight,
                                                            }}
                                                        >
                                                            {img.creatorName}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        )
                                    })()}
                            </div>
                        </div>
                    )
                })}
            </div>

            {showInfoOnHover &&
                centeredSlot &&
                !!(
                    centeredSlot.title ||
                    centeredSlot.type ||
                    centeredSlot.releaseYear ||
                    centeredSlot.creatorName ||
                    centeredSlot.posterName
                ) && (
                    <div
            style={{
                position: "absolute",
                left: "50%",
                bottom: 32,
                transform: "translateX(-50%)",
                zIndex: 2000,
                pointerEvents: "none",
                overflow: "hidden",
            }}
        >
                        <AnimatePresence
                            mode="wait"
                            custom={infoDirection}
                            initial={false}
                        >
                            <motion.div
    key={frontCol}
    custom={infoDirection}
    variants={infoVariants}
    initial="enter"
    animate="center"
    exit="exit"
    transition={{
        duration: 0.25,
        ease: [0.65, 0, 0.35, 1],
    }}
    style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        width: "fit-content",
    }}
>
    {centeredSlot.title && (
        <InfoChip
            label={centeredSlot.title}
            bg="transparent"  
            textColor={infoBgColor}
            fontSize={infoFontSize}
        />
    )}
    {centeredSlot.creatorName && (
        <InfoChip
            label={centeredSlot.creatorName}
            bg="transparent" 
            textColor={infoBgColor} 
            fontSize={infoFontSize}
        />
    )}
    {(centeredSlot.type ||
        centeredSlot.genre ||
        centeredSlot.releaseYear) && (
        <div
            style={{
                display: "flex",
                flexDirection: "row",
                justifyContent: "center",
                gap: 12,
            }}
        >
            {centeredSlot.type && (
                <InfoChip
                    label={centeredSlot.type}
                    bg="transparent"
                    textColor={mutedInfoTextColor}
                    fontSize={infoFontSize}
                />
            )}
            {centeredSlot.genre && (
                <InfoChip
                    label={centeredSlot.genre}
                    bg="transparent"
                    textColor={mutedInfoTextColor}
                    fontSize={infoFontSize}
                />
            )}
            {centeredSlot.releaseYear && (
                <InfoChip
                    label={String(centeredSlot.releaseYear)}
                    bg="transparent"
                    textColor={mutedInfoTextColor}
                    fontSize={infoFontSize}
                />
            )}
        </div>
    )}
</motion.div>
                        </AnimatePresence>
                    </div>
                )}
        </div>
    )
}

// ─── NewEntryModal ──────────────────────────────────────────────────────────
const TYPE_OPTIONS: Record<string, string[]> = {
    Music: ["Single", "Album", "EP", "Curated Playlist"],
    Film: ["Movie", "Series", "Documentary", "Short Film", "Mini Series"],
    Books: ["Nonfiction", "Fiction", "Poetry", "Graphic Novel"],
}

const GENRE_OPTIONS: Record<string, string[]> = {
    Music: [
        "Pop", "R&B", "Hip-Hop", "Jazz", "Classical", "Electronic", "Rock",
        "Afrobeats", "Indie", "Soul", "Blues", "Funk", "LoFi", "Disco",
        "Dance", "Dance Pop", "Vocal", "Adult Contemporary", "Contemporary",
        "Heavy Metal", "Amapiano", "High Life", "Acapella", "Beatbox",
        "K-Pop", "Country", "Art-pop", "Alternative", "Mixed genre",
    ],
    Film: [
        "Action", "Comedy", "Drama", "Horror", "Sci-Fi", "Thriller",
        "Romance", "Animation", "Fantasy", "Sitcom", "Crime", "Friendship",
        "Youth", "Coming Of Age", "Law", "Noir", "Dark Comedy", "Mystery",
        "Family", "Historical", "Melodrama", "Apocalypse", "Psychological",
        "Slice Of Life", "Political", "Medical", "Revenge", "Survival",
        "Sports", "Financial", "Suspense",
    ],
    Books: [
        "Literary Fiction", "Mystery", "Science Fiction", "Fantasy",
        "Self-Help", "History", "Philosophy", "Essays", "Thriller",
        "Romance", "Biography", "Autobiography", "Memoir", "Contemporary",
        "Erotic", "Adult", "Music", "Pop Culture", "Suspense", "Manga",
        "Webtoon", "Anime", "Historical", "Arts", "Design", "Creative",
        "Business", "Economics", "Finance", "True Crime",
    ],
}

function NewEntryModal({
    visible,
    onClose,
    theme,
    defaultCategory,
    entries,
    editingEntry,
    onSubmitted,
    onDuplicate,
}: {
    visible: boolean
    onClose: () => void
    theme: "light" | "dark"
    defaultCategory: string
    entries: Entry[]
    editingEntry?: Entry | null
    onSubmitted?: (entry: Entry) => void
    onDuplicate?: (existing: Entry) => void
}) {
    const font = "'Spline Sans Mono', monospace"
    const pink = "#E298F2"
    const dark = "#1C1C1C"
    const white = "#FEFEFE"

    const modalBg = theme === "light" ? dark : white
    const stackBg = modalBg
    const textColor = theme === "light" ? white : dark
    const rowBg =
        theme === "light" ? "rgba(254, 254, 254, 0.1)" : "rgba(28, 28, 28, 0.1)"
    const rowBorder =
        theme === "light" ? "rgba(254, 254, 254, 0.3)" : "rgba(28, 28, 28, 0.3)"
    const dragBorderActive =
        theme === "light" ? "rgba(254, 254, 254, 1)" : "rgba(28, 28, 28, 1)"
    const chipBg =
        theme === "light"
            ? "rgba(254, 254, 254, 0.10)"
            : "rgba(28, 28, 28, 0.10)"
    const placeholderColor =
        theme === "light" ? "rgba(254, 254, 254, 0.4)" : "rgba(28, 28, 28, 0.4)"
    const toggleActiveBg = theme === "light" ? white : dark
    const toggleActiveText = theme === "light" ? dark : white
    const footerBg = stackBg
    const cancelBg = theme === "light" ? white : dark
    const cancelTextColor = theme === "light" ? dark : white

    const [category, setCategory] = useState(defaultCategory)
    const [type, setType] = useState("")
    const [genres, setGenres] = useState<string[]>([])
    const [genreMenuOpen, setGenreMenuOpen] = useState(false)
    const [genreSearch, setGenreSearch] = useState("")
    const [title, setTitle] = useState("")
    const [artist, setArtist] = useState("")
    const [releaseYear, setReleaseYear] = useState("")
    const [comment, setComment] = useState("")
    const [username, setUsername] = useState("")
    const [coverFile, setCoverFile] = useState<File | null>(null)
    const [coverPreview, setCoverPreview] = useState<string | null>(null)
    const [url, setUrl] = useState("")
    const [previewUrl, setPreviewUrl] = useState("")
    const [isDraggingCover, setIsDraggingCover] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const isFormValid =
        title.trim().length > 0 &&
        artist.trim().length > 0 &&
        type.trim().length > 0 &&
        genres.length > 0 &&
        releaseYear.trim().length > 0
    const isEditing = !!editingEntry 
    const errorBorderColor = "#FF5C5C"
    const [showValidation, setShowValidation] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const genreContainerRef = useRef<HTMLDivElement>(null)
    const outerRef = useRef<HTMLDivElement>(null)
    const panelOffsetY = useMotionValue(0)
    const collapsedOffsetRef = useRef(0)
    const expandedOffsetRef = useRef(0)
    const currentOffsetRef = useRef(0)
    const touchLastYRef = useRef<number | null>(null)

    useEffect(() => {
    if (visible) {
        if (editingEntry) {
            setCategory(
                REVERSE_CATEGORY_MAP[editingEntry.category] || defaultCategory
            )
            setType(toTitleCaseLabel(editingEntry.subcategory))
            setGenres(
                editingEntry.genre ? editingEntry.genre.split(",") : []
            )
            setTitle(editingEntry.title)
            setArtist(editingEntry.creator_name)
            setReleaseYear(
                editingEntry.release_year
                    ? String(editingEntry.release_year)
                    : ""
            )
            setComment(editingEntry.comment || "")
            setUsername(
                editingEntry.poster_username === "Anonymous"
                    ? ""
                    : editingEntry.poster_username
            )
            setCoverPreview(editingEntry.cover_image_url)
            setUrl(editingEntry.external_link || "")
            setPreviewUrl(editingEntry.preview_url || "")
        } else {
            setCategory(defaultCategory)
        }
    } else {
        resetForm()
    }
}, [visible, defaultCategory, editingEntry])

    const toggleGenre = (g: string) => {
        setGenres((prev) => {
            if (prev.includes(g)) return prev.filter((x) => x !== g)
            if (prev.length >= 4) return prev
            return [...prev, g]
        })
    }

    useEffect(() => {
        if (!genreMenuOpen) {
            setGenreSearch("")
            return
        }
        const handleClickOutside = (e: MouseEvent) => {
            if (
                genreContainerRef.current &&
                !genreContainerRef.current.contains(e.target as Node)
            ) {
                setGenreMenuOpen(false)
            }
        }
        document.addEventListener("mousedown", handleClickOutside)
        return () =>
            document.removeEventListener("mousedown", handleClickOutside)
    }, [genreMenuOpen])

    const resetForm = () => {
        setShowValidation(false)
        setType("")
        setGenres([])
        setTitle("")
        setArtist("")
        setReleaseYear("")
        setComment("")
        setUsername("")
        setCoverFile(null)
        setCoverPreview(null)
        setUrl("")
        setPreviewUrl("")
    }

    const handleClose = () => {
        playClickSound()
        onClose()
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (
            e.key === "Enter" &&
            (e.target as HTMLElement).tagName !== "TEXTAREA"
        ) {
            e.preventDefault()
            if (isFormValid && !submitting) handleSubmit()
        }
    }

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        setCoverFile(file)
        setCoverPreview(URL.createObjectURL(file))
    }

    const applyDroppedFile = (file: File) => {
        if (!file.type.startsWith("image/")) return
        setCoverFile(file)
        setCoverPreview(URL.createObjectURL(file))
    }

    const handleSubmit = async () => {
    if (submitting) return
    if (!isFormValid) {
        setShowValidation(true)
        return
    }

    if (!editingEntry) {
        const duplicate = isDuplicateEntry(
            entries,
            CATEGORY_MAP[category],
            title,
            artist
        )
        if (duplicate) {
            onDuplicate?.(duplicate)
            return
        }
    }

    setSubmitting(true)
    try {
        let coverUrl: string | null = editingEntry?.cover_image_url ?? null
        if (coverFile) {
            try {
                const presignRes = await fetch(UPLOAD_WORKER_URL, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        filename: coverFile.name,
                        contentType: coverFile.type,
                    }),
                })
                if (!presignRes.ok) {
                    throw new Error(`Presign failed: ${presignRes.status}`)
                }
                const { uploadUrl, publicUrl } = await presignRes.json()

                const putRes = await fetch(uploadUrl, {
                    method: "PUT",
                    headers: { "Content-Type": coverFile.type },
                    body: coverFile,
                })
                if (!putRes.ok) {
                    throw new Error(`Upload failed: ${putRes.status}`)
                }
                coverUrl = publicUrl
            } catch (uploadError) {
                console.error("Cover upload failed:", uploadError)
            }
        } else if (editingEntry && coverPreview === null) {
            coverUrl = null
        }

        const entryData = {
            category: CATEGORY_MAP[category],
            subcategory: type.toLowerCase().replace(/\s+/g, "_"),
            genre: genres.length > 0 ? genres.join(",") : null,
            title: title.trim(),
            creator_name: artist.trim(),
            cover_image_url: coverUrl,
            external_link: url.trim() || null,
            preview_url:
                type === "Curated Playlist"
                    ? previewUrl.trim() || null
                    : null,
            comment: comment.trim() || null,
            poster_username: username.trim() || "Anonymous",
            release_year: releaseYear.trim()
                ? parseInt(releaseYear.trim(), 10)
                : null,
        }

        try {
            const savedEntry = editingEntry
                ? await updateEntry(editingEntry.id, entryData)
                : await addEntry(entryData)
            onSubmitted?.(savedEntry)
            resetForm()
            onClose()
        } catch (insertError) {
            console.error(
                editingEntry ? "Entry update failed:" : "Entry insert failed:",
                insertError
            )
        }
    } finally {
        setSubmitting(false)
    }
}

    const measureTravelBounds = useCallback(() => {
        if (typeof window === "undefined") return
        const panel = outerRef.current
        if (!panel) return
        const panelHeight = panel.scrollHeight
        const viewportHeight = window.innerHeight
        expandedOffsetRef.current = -78
        collapsedOffsetRef.current = Math.max(
            0,
            panelHeight - viewportHeight * 0.5
        )
    }, [])

    const applyPanelOffset = useCallback((nextOffset: number) => {
        const clamped = Math.max(
            expandedOffsetRef.current,
            Math.min(collapsedOffsetRef.current, nextOffset)
        )
        currentOffsetRef.current = clamped
        panelOffsetY.set(clamped)
    }, [])

    const movePanelBy = useCallback((deltaY: number) => {
        applyPanelOffset(currentOffsetRef.current + deltaY)
    }, [])

    const handleWheelMove = useCallback((e: React.WheelEvent) => {
        e.preventDefault()
        movePanelBy(-e.deltaY)
    }, [])

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        touchLastYRef.current = e.touches[0]?.clientY ?? null
    }, [])

    const handleTouchMove = useCallback((e: React.TouchEvent) => {
        if (touchLastYRef.current === null) return
        e.preventDefault()
        const currentY = e.touches[0]?.clientY ?? touchLastYRef.current
        const delta = currentY - touchLastYRef.current
        touchLastYRef.current = currentY
        movePanelBy(delta)
    }, [])

    const handleTouchEnd = useCallback(() => {
        touchLastYRef.current = null
    }, [])

    useLayoutEffect(() => {
        if (!visible) return
        measureTravelBounds()
        applyPanelOffset(collapsedOffsetRef.current)
    }, [visible])

    useLayoutEffect(() => {
    if (!visible) return
    measureTravelBounds()
    applyPanelOffset(currentOffsetRef.current)
}, [category, type, visible, measureTravelBounds])

    useEffect(() => {
        if (!visible) return
        if (typeof window === "undefined") return
        const onResize = () => {
            measureTravelBounds()
            applyPanelOffset(currentOffsetRef.current)
        }
        window.addEventListener("resize", onResize)
        return () => window.removeEventListener("resize", onResize)
    }, [visible, measureTravelBounds, applyPanelOffset])

    useEffect(() => {
    if (!visible) return
    const panel = outerRef.current
    if (!panel) return
    const ro = new ResizeObserver(() => {
        const wasUnadjusted = currentOffsetRef.current === 0
        measureTravelBounds()
        applyPanelOffset(
            wasUnadjusted ? collapsedOffsetRef.current : currentOffsetRef.current
        )
    })
    ro.observe(panel)
    return () => ro.disconnect()
}, [visible, measureTravelBounds, applyPanelOffset])

    useEffect(() => {
        if (!visible) return
        if (typeof document === "undefined") return
        const prevOverflow = document.body.style.overflow
        document.body.style.overflow = "hidden"
        return () => {
            document.body.style.overflow = prevOverflow
        }
    }, [visible])

    const labelStyle: React.CSSProperties = {
        fontFamily: font,
        fontWeight: 500,
        fontSize: 12,
        lineHeight: "17px",
        color: textColor,
    }

    const fieldLabelStyle: React.CSSProperties = {
        ...labelStyle,
        display: "inline-block",
        background: pink,
        color: dark,
        padding: "2px 0px",
        width: "fit-content",
        alignSelf: "flex-start",
    }

    const inputStyle: React.CSSProperties = {
        fontFamily: font,
        fontWeight: 500,
        fontSize: 14,
        lineHeight: "17px",
        color: textColor,
        background: "transparent",
        border: "none",
        outline: "none",
        width: "100%",
        ["--placeholder-color" as any]: placeholderColor,
    }

    const toggleTab = (
        label: string,
        active: boolean,
        onClick: () => void,
        fontSize: number = 14
    ) => (
        <div
            key={label}
            onClick={() => {
                playClickSound()
                onClick()
            }}
            style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                padding: "8px 0px",
                gap: 4,
                flex: 1,
                height: 26,
                background: active ? toggleActiveBg : rowBg,
                cursor: "pointer",
                justifyContent: "flex-start",
            }}
        >
            <span
                style={{
                    ...labelStyle,
                    fontSize,
                    color: active ? toggleActiveText : textColor,
                }}
            >
                {label}
            </span>
        </div>
    )

    return (
        <AnimatePresence>
            {visible && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.3 }}
                        onClick={handleClose}
                        onWheel={handleWheelMove}
                        onTouchStart={handleTouchStart}
                        onTouchMove={handleTouchMove}
                        onTouchEnd={handleTouchEnd}
                        onTouchCancel={handleTouchEnd}
                        style={{
                            position: "fixed",
                            inset: 0,
                            zIndex: 10001,
                            backdropFilter: "blur(8px)",
                            WebkitBackdropFilter: "blur(8px)",
                            pointerEvents: "auto",
                            touchAction: "none",
                            cursor: "pointer",
                        }}
                    />
                    <motion.div
                        ref={outerRef}
                        initial={{ x: "100%" }}
                        animate={{ x: 0 }}
                        exit={{ x: "100%" }}
                        transition={{
                            duration: 0.45,
                            ease: [0.16, 1, 0.3, 1],
                        }}
                        onWheel={handleWheelMove}
                        onTouchStart={handleTouchStart}
                        onTouchMove={handleTouchMove}
                        onTouchEnd={handleTouchEnd}
                        onTouchCancel={handleTouchEnd}
                        onKeyDown={handleKeyDown}
                        style={{
                            position: "fixed",
                            right: 8,
                            bottom: 0,
                            width: "50vw",
                            background: "transparent",
                            zIndex: 10002,
                            y: panelOffsetY,
                            touchAction: "none",
                        }}
                    >
                        <div
                            style={{
                                display: "flex",
                                flexDirection: "column",
                            }}
                        >
                            <div
                                onClick={handleClose}
                                style={{
                                    display: "flex",
                                    flexDirection: "row",
                                    justifyContent: "flex-end",
                                    alignItems: "center",
                                    gap: 8,
                                    width: "fit-content",
                                    marginLeft: "auto",
                                    background: pink,
                                    cursor: "pointer",
                                }}
                            >
                                <div
                                    style={{
                                        display: "flex",
                                        flexDirection: "row",
                                        justifyContent: "flex-end",
                                        alignItems: "flex-end",
                                        padding: "8px 0px",
                                    }}
                                >
                                    <span style={{ ...labelStyle, fontSize: 14, color: dark }}>
    {isEditing ? "Edit Entry" : "New Entry"}
</span>
                                </div>
                                <div
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        padding: 3,
                                        width: 26,
                                        height: 26,
                                        boxSizing: "border-box",
                                        cursor: "pointer",
                                    }}
                                >
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                        <path
                                            d="M13.0306 11.9695C13.1715 12.1104 13.2506 12.3015 13.2506 12.5007C13.2506 12.7 13.1715 12.8911 13.0306 13.032C12.8897 13.1729 12.6986 13.252 12.4993 13.252C12.3001 13.252 12.109 13.1729 11.9681 13.032L7.99997 9.06261L4.0306 13.0307C3.8897 13.1716 3.69861 13.2508 3.49935 13.2508C3.30009 13.2508 3.10899 13.1716 2.9681 13.0307C2.8272 12.8898 2.74805 12.6987 2.74805 12.4995C2.74805 12.3002 2.8272 12.1091 2.9681 11.9682L6.93747 8.00011L2.96935 4.03073C2.82845 3.88984 2.7493 3.69874 2.7493 3.49948C2.7493 3.30023 2.82845 3.10913 2.96935 2.96823C3.11024 2.82734 3.30134 2.74818 3.5006 2.74818C3.69986 2.74818 3.89095 2.82734 4.03185 2.96823L7.99997 6.93761L11.9693 2.96761C12.1102 2.82671 12.3013 2.74756 12.5006 2.74756C12.6999 2.74756 12.891 2.82671 13.0318 2.96761C13.1727 3.10851 13.2519 3.2996 13.2519 3.49886C13.2519 3.69812 13.1727 3.88921 13.0318 4.03011L9.06247 8.00011L13.0306 11.9695Z"
                                            fill={dark}
                                        />
                                    </svg>
                                </div>
                            </div>

                            <div
                                style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    background: stackBg,
                                }}
                            >
                                <div
                                    style={{
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: 16,
                                        background: stackBg,
                                    }}
                                >
                                    <div
                                        style={{
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: 0,
                                        }}
                                    >
                                        <span style={fieldLabelStyle}>
                                            Category
                                        </span>
                                        <div
                                            style={{
                                                display: "flex",
                                                flexDirection: "row",
                                            }}
                                        >
                                            {["Music", "Film", "Books"].map(
                                                (c) =>
                                                    toggleTab(
                                                        c,
                                                        category === c,
                                                        () => {
                                                            setCategory(c)
                                                            setGenres([])
                                                        }
                                                    )
                                            )}
                                        </div>
                                    </div>

                                    <div
                                        style={{
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: 0,
                                        }}
                                    >
                                        <span style={fieldLabelStyle}>
                                            Type
                                        </span>
                                        <div
                                            style={{
                                                display: "grid",
                                                gridTemplateColumns:
                                                    "repeat(3, 1fr)",
                                                border: `1px solid ${
                                                    showValidation && !type
                                                        ? errorBorderColor
                                                        : "transparent"
                                                }`,
                                            }}
                                        >
                                            {(TYPE_OPTIONS[category] || []).map(
                                                (t) =>
                                                    toggleTab(
                                                        t,
                                                        type === t,
                                                        () => setType(t),
                                                        14
                                                    )
                                            )}
                                        </div>
                                    </div>

                                    <div
                                        style={{
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: 0,
                                        }}
                                    >
                                        <span style={fieldLabelStyle}>
                                            Title
                                        </span>
                                        <input
                                            value={title}
                                            onChange={(e) =>
                                                setTitle(e.target.value)
                                            }
                                            placeholder={
                                                category === "Music"
                                                    ? "e.g ANTI"
                                                    : category === "Film"
                                                      ? "e.g The Bear"
                                                      : "e.g The Hobbit"
                                            }
                                            className="modal-field-input"
                                            style={{
                                                ...inputStyle,
                                                padding: "16px 0",
                                                background: rowBg,
                                                borderBottom: `1px solid ${
                                                    showValidation &&
                                                    !title.trim()
                                                        ? errorBorderColor
                                                        : rowBorder
                                                }`,
                                            }}
                                        />
                                    </div>

                                    <div
                                        style={{
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: 0,
                                        }}
                                    >
                                        <span style={fieldLabelStyle}>
                                            {category === "Music"
                                                ? "Artist"
                                                : category === "Film"
                                                  ? "Creator/Writer/Director"
                                                  : "Author"}
                                        </span>
                                        <input
                                            value={artist}
                                            onChange={(e) =>
                                                setArtist(e.target.value)
                                            }
                                            placeholder={
                                                category === "Music"
                                                    ? "e.g Rihanna"
                                                    : category === "Film"
                                                      ? "e.g Christopher Storer"
                                                      : "e.g J. R. R. Tolkien"
                                            }
                                            className="modal-field-input"
                                            style={{
                                                ...inputStyle,
                                                padding: "16px 0",
                                                background: rowBg,
                                                borderBottom: `1px solid ${
                                                    showValidation &&
                                                    !artist.trim()
                                                        ? errorBorderColor
                                                        : rowBorder
                                                }`,
                                            }}
                                        />
                                    </div>

                                    <div
                                        style={{
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: 0,
                                        }}
                                    >
                                        <span style={fieldLabelStyle}>
                                            Genre
                                        </span>
                                        <div
                                            ref={genreContainerRef}
                                            style={{ position: "relative" }}
                                        >
                                            <div
                                                onClick={() =>
                                                    setGenreMenuOpen(
                                                        (prev) => !prev
                                                    )
                                                }
                                                style={{
                                                    display: "flex",
                                                    flexDirection: "row",
                                                    alignItems: "center",
                                                    justifyContent:
                                                        "space-between",
                                                    padding: "16px 0",
                                                    gap: 8,
                                                    height: 50,
                                                    background: rowBg,
                                                    borderBottom: `1px solid ${
                                                        showValidation &&
                                                        genres.length === 0
                                                            ? errorBorderColor
                                                            : rowBorder
                                                    }`,
                                                    cursor: "pointer",
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        display: "flex",
                                                        flexDirection: "row",
                                                        alignItems: "center",
                                                        gap: 8,
                                                        flexWrap: "nowrap",
                                                        overflowX: "auto",
                                                        flex: 1,
                                                    }}
                                                >
                                                    {genres.length === 0 ? (
                                                        <span
                                                            style={{
                                                                ...labelStyle,
                                                                fontSize: 14,
                                                                color: placeholderColor,
                                                            }}
                                                        >
                                                            Select genres
                                                        </span>
                                                    ) : (
                                                        genres.map((g) => (
                                                            <div
                                                                key={g}
                                                                style={{
                                                                    display:
                                                                        "flex",
                                                                    flexDirection:
                                                                        "row",
                                                                    alignItems:
                                                                        "center",
                                                                    height: 42,
                                                                    padding:
                                                                        "0 8px",
                                                                    gap: 4,
                                                                    background:
                                                                        chipBg,
                                                                    boxSizing:
                                                                        "border-box",
                                                                    flexShrink: 0,
                                                                }}
                                                            >
                                                                <span
                                                                    style={
                                                                        labelStyle
                                                                    }
                                                                >
                                                                    {g}
                                                                </span>
                                                                <div
                                                                    onClick={(
                                                                        e
                                                                    ) => {
                                                                        e.stopPropagation()
                                                                        playClickSound()
                                                                        toggleGenre(
                                                                            g
                                                                        )
                                                                    }}
                                                                    style={{
                                                                        width: 16,
                                                                        height: 16,
                                                                        display:
                                                                            "flex",
                                                                        alignItems:
                                                                            "center",
                                                                        justifyContent:
                                                                            "center",
                                                                        cursor: "pointer",
                                                                    }}
                                                                >
                                                                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                                                                        <path
                                                                            d="M13.0306 11.9695C13.1715 12.1104 13.2506 12.3015 13.2506 12.5007C13.2506 12.7 13.1715 12.8911 13.0306 13.032C12.8897 13.1729 12.6986 13.252 12.4993 13.252C12.3001 13.252 12.109 13.1729 11.9681 13.032L7.99997 9.06261L4.0306 13.0307C3.8897 13.1716 3.69861 13.2508 3.49935 13.2508C3.30009 13.2508 3.10899 13.1716 2.9681 13.0307C2.8272 12.8898 2.74805 12.6987 2.74805 12.4995C2.74805 12.3002 2.8272 12.1091 2.9681 11.9682L6.93747 8.00011L2.96935 4.03073C2.82845 3.88984 2.7493 3.69874 2.7493 3.49948C2.7493 3.30023 2.82845 3.10913 2.96935 2.96823C3.11024 2.82734 3.30134 2.74818 3.5006 2.74818C3.69986 2.74818 3.89095 2.82734 4.03185 2.96823L7.99997 6.93761L11.9693 2.96761C12.1102 2.82671 12.3013 2.74756 12.5006 2.74756C12.6999 2.74756 12.891 2.82671 13.0318 2.96761C13.1727 3.10851 13.2519 3.2996 13.2519 3.49886C13.2519 3.69812 13.1727 3.88921 13.0318 4.03011L9.06247 8.00011L13.0306 11.9695Z"
                                                                            fill={
                                                                                textColor
                                                                            }
                                                                        />
                                                                    </svg>
                                                                </div>
                                                            </div>
                                                        ))
                                                    )}
                                                </div>
                                                <Icon.Caret
                                                    color={textColor}
                                                    rotate={
                                                        genreMenuOpen ? 0 : -90
                                                    }
                                                />
                                            </div>

                                            {genreMenuOpen && (
                                                <div
                                                    onWheel={(e) =>
                                                        e.stopPropagation()
                                                    }
                                                    onTouchMove={(e) =>
                                                        e.stopPropagation()
                                                    }
                                                    style={{
                                                        position: "absolute",
                                                        top: "100%",
                                                        left: 0,
                                                        right: 0,
                                                        zIndex: 10,
                                                        background: modalBg,
                                                        maxHeight: 200,
                                                        overflowY: "auto",
                                                    }}
                                                >
                                                    <div
                                                        style={{
                                                            display: "flex",
                                                            flexDirection:
                                                                "row",
                                                            alignItems:
                                                                "center",
                                                            gap: 8,
                                                            padding: "8px 0",
                                                            position: "sticky",
                                                            top: 0,
                                                            background: modalBg,
                                                            zIndex: 1,
                                                        }}
                                                    >
                                                        <Icon.Search
                                                            color={textColor}
                                                        />
                                                        <input
                                                            value={genreSearch}
                                                            onChange={(e) =>
                                                                setGenreSearch(
                                                                    e.target
                                                                        .value
                                                                )
                                                            }
                                                            onClick={(e) =>
                                                                e.stopPropagation()
                                                            }
                                                            placeholder={`e.g. ${(GENRE_OPTIONS[category] || []).slice(0, 3).join(", ")}`}
                                                            className="modal-field-input"
                                                            style={{
                                                                ...inputStyle,
                                                                padding: 0,
                                                            }}
                                                        />
                                                    </div>
                                                    {(
                                                        GENRE_OPTIONS[
                                                            category
                                                        ] || []
                                                    )
                                                        .filter((g) => {
                                                            const normalizedQuery =
                                                                normalizeSearchText(
                                                                    genreSearch.trim()
                                                                )
                                                            if (
                                                                !normalizedQuery
                                                            )
                                                                return true
                                                            const normalizedGenre =
                                                                normalizeSearchText(
                                                                    g
                                                                )
                                                            if (
                                                                normalizedGenre.includes(
                                                                    normalizedQuery
                                                                )
                                                            )
                                                                return true
                                                            const compactQuery =
                                                                toCompactSearchText(
                                                                    normalizedQuery
                                                                )
                                                            const compactGenre =
                                                                toCompactSearchText(
                                                                    normalizedGenre
                                                                )
                                                            if (
                                                                compactQuery &&
                                                                compactGenre.includes(
                                                                    compactQuery
                                                                )
                                                            )
                                                                return true
                                                            return compactQuery
                                                                ? isSubsequenceMatch(
                                                                      compactQuery,
                                                                      compactGenre
                                                                  )
                                                                : false
                                                        })
                                                        .map((g) => {
                                                            const selected =
                                                                genres.includes(
                                                                    g
                                                                )
                                                            const disabled =
                                                                !selected &&
                                                                genres.length >=
                                                                    4
                                                            return (
                                                                <div
                                                                    key={g}
                                                                    onClick={() => {
                                                                        if (
                                                                            disabled
                                                                        )
                                                                            return
                                                                        playClickSound()
                                                                        toggleGenre(
                                                                            g
                                                                        )
                                                                    }}
                                                                    style={{
                                                                        display:
                                                                            "flex",
                                                                        alignItems:
                                                                            "center",
                                                                        padding:
                                                                            "6px 0",
                                                                        background:
                                                                            selected
                                                                                ? rowBg
                                                                                : "transparent",
                                                                        cursor: disabled
                                                                            ? "not-allowed"
                                                                            : "pointer",
                                                                        opacity:
                                                                            disabled
                                                                                ? 0.4
                                                                                : 1,
                                                                    }}
                                                                >
                                                                    <span
                                                                        style={
                                                                            labelStyle
                                                                        }
                                                                    >
                                                                        {g}
                                                                    </span>
                                                                </div>
                                                            )
                                                        })}
                                                </div>
                                            )}
                                        </div>
                                        <span
                                            style={{
                                                ...labelStyle,
                                                fontSize: 12,
                                                color: placeholderColor,
                                            }}
                                        >
                                            Add up to 4 genres
                                        </span>
                                    </div>

                                    <div
                                        style={{
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: 0,
                                        }}
                                    >
                                        <span style={fieldLabelStyle}>
                                            Release year
                                        </span>
                                        <input
                                            value={releaseYear}
                                            onChange={(e) => {
                                                const v = e.target.value
                                                if (/^\d{0,4}$/.test(v))
                                                    setReleaseYear(v)
                                            }}
                                            placeholder="e.g 2016"
                                            inputMode="numeric"
                                            className="modal-field-input"
                                            style={{
                                                ...inputStyle,
                                                padding: "16px 0",
                                                background: rowBg,
                                                borderBottom: `1px solid ${
                                                    showValidation &&
                                                    !releaseYear.trim()
                                                        ? errorBorderColor
                                                        : rowBorder
                                                }`,
                                            }}
                                        />
                                    </div>

                                    <div
                                        style={{
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: 0,
                                        }}
                                    >
                                        <span style={fieldLabelStyle}>
                                            Cover image
                                        </span>
                                        <div
                                            onClick={() =>
                                                fileInputRef.current?.click()
                                            }
                                            onDragOver={(e) => {
                                                e.preventDefault()
                                                setIsDraggingCover(true)
                                            }}
                                            onDragEnter={(e) => {
                                                e.preventDefault()
                                                setIsDraggingCover(true)
                                            }}
                                            onDragLeave={(e) => {
                                                e.preventDefault()
                                                setIsDraggingCover(false)
                                            }}
                                            onDrop={(e) => {
                                                e.preventDefault()
                                                setIsDraggingCover(false)
                                                const file =
                                                    e.dataTransfer.files?.[0]
                                                if (file) applyDroppedFile(file)
                                            }}
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "space-between",
                                                height: 50,
                                                background: rowBg,
                                                border: `1px dashed ${
                                                    isDraggingCover
                                                        ? dragBorderActive
                                                        : rowBorder
                                                }`,
                                                cursor: "pointer",
                                                gap: 8,
                                                boxSizing: "border-box",
                                            }}
                                        >
                                            <div
                                                style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: 8,
                                                    minWidth: 0,
                                                }}
                                            >
                                                {coverPreview ? (
                                                    <img
                                                        src={coverPreview}
                                                        alt=""
                                                        style={{
                                                            width: 42,
                                                            height: 42,
                                                            objectFit: "cover",
                                                            flexShrink: 0,
                                                        }}
                                                    />
                                                ) : null}
                                                <span
                                                    style={{
                                                        ...labelStyle,
                                                        fontSize: 14,
                                                        color: placeholderColor,
                                                        overflow: "hidden",
                                                        whiteSpace: "nowrap",
                                                        textOverflow:
                                                            "ellipsis",
                                                    }}
                                                >
                                                    {coverFile
                                                        ? coverFile.name
                                                        : "Click to upload image or drag an image to frame"}
                                                </span>
                                            </div>
                                            {coverPreview && (
                                                <div
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        playClickSound()
                                                        setCoverFile(null)
                                                        setCoverPreview(null)
                                                    }}
                                                    style={{
                                                        width: 42,
                                                        height: 42,
                                                        display: "flex",
                                                        alignItems: "center",
                                                        justifyContent:
                                                            "center",
                                                        cursor: "pointer",
                                                        flexShrink: 0,
                                                    }}
                                                >
                                                    <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                                                        <path
                                                            d="M13.0306 11.9695C13.1715 12.1104 13.2506 12.3015 13.2506 12.5007C13.2506 12.7 13.1715 12.8911 13.0306 13.032C12.8897 13.1729 12.6986 13.252 12.4993 13.252C12.3001 13.252 12.109 13.1729 11.9681 13.032L7.99997 9.06261L4.0306 13.0307C3.8897 13.1716 3.69861 13.2508 3.49935 13.2508C3.30009 13.2508 3.10899 13.1716 2.9681 13.0307C2.8272 12.8898 2.74805 12.6987 2.74805 12.4995C2.74805 12.3002 2.8272 12.1091 2.9681 11.9682L6.93747 8.00011L2.96935 4.03073C2.82845 3.88984 2.7493 3.69874 2.7493 3.49948C2.7493 3.30023 2.82845 3.10913 2.96935 2.96823C3.11024 2.82734 3.30134 2.74818 3.5006 2.74818C3.69986 2.74818 3.89095 2.82734 4.03185 2.96823L7.99997 6.93761L11.9693 2.96761C12.1102 2.82671 12.3013 2.74756 12.5006 2.74756C12.6999 2.74756 12.891 2.82671 13.0318 2.96761C13.1727 3.10851 13.2519 3.2996 13.2519 3.49886C13.2519 3.69812 13.1727 3.88921 13.0318 4.03011L9.06247 8.00011L13.0306 11.9695Z"
                                                            fill={textColor}
                                                        />
                                                    </svg>
                                                </div>
                                            )}
                                        </div>
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            accept="image/*"
                                            onChange={handleFileChange}
                                            style={{ display: "none" }}
                                        />
                                    </div>

                                    <div
                                        style={{
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: 0,
                                        }}
                                    >
                                        <span style={fieldLabelStyle}>URL</span>
                                        <input
                                            value={url}
                                            onChange={(e) =>
                                                setUrl(e.target.value)
                                            }
                                            placeholder="Add URL link"
                                            className="modal-field-input"
                                            style={{
                                                ...inputStyle,
                                                padding: "16px 0",
                                                background: rowBg,
                                                borderBottom: `1px solid ${rowBorder}`,
                                            }}
                                        />
                                    </div>

                                    {type === "Curated Playlist" && (
                                        <div
                                            style={{
                                                display: "flex",
                                                flexDirection: "column",
                                                gap: 0,
                                            }}
                                        >
                                            <span style={fieldLabelStyle}>
                                                Preview URL
                                            </span>
                                            <input
                                                value={previewUrl}
                                                onChange={(e) =>
                                                    setPreviewUrl(
                                                        e.target.value
                                                    )
                                                }
                                                placeholder="Paste a Spotify track link from the playlist"
                                                className="modal-field-input"
                                                style={{
                                                    ...inputStyle,
                                                    padding: "16px 0",
                                                    background: rowBg,
                                                    borderBottom: `1px solid ${rowBorder}`,
                                                }}
                                            />
                                            <span
                                                style={{
                                                    ...labelStyle,
                                                    fontSize: 12,
                                                    color: placeholderColor,
                                                }}
                                            >
                                                Link to any one track on Spotify
                                                — we'll auto-detect the song for
                                                preview
                                            </span>
                                        </div>
                                    )}

                                    <div
                                        style={{
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: 0,
                                        }}
                                    >
                                        <span style={fieldLabelStyle}>
                                            Comments
                                        </span>
                                        <textarea
                                            value={comment}
                                            onChange={(e) => {
                                                const v = e.target.value
                                                if (v.length <= 200)
                                                    setComment(v)
                                            }}
                                            placeholder="What do you think of it?"
                                            rows={3}
                                            maxLength={200}
                                            className="modal-field-input"
                                            style={{
                                                ...inputStyle,
                                                padding: "16px 0",
                                                background: rowBg,
                                                borderBottom: `1px solid ${rowBorder}`,
                                                resize: "none",
                                            }}
                                        />
                                        <span
                                            style={{
                                                ...labelStyle,
                                                fontSize: 12,
                                                color: placeholderColor,
                                            }}
                                        >
                                            Max 200 characters
                                        </span>
                                    </div>

                                    <div
    style={{
        display: "flex",
        flexDirection: "column",
        gap: 0,
    }}
>
    <span style={fieldLabelStyle}>
        Username
    </span>
    <div
        style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            padding: "16px 0",
            background: rowBg,
            borderBottom: `1px solid ${rowBorder}`,
        }}
    >
        <span style={{ ...inputStyle, width: "auto", flexShrink: 0 }}>
            @
        </span>
        <input
            value={username}
            onChange={(e) =>
                setUsername(e.target.value)
            }
            placeholder="Anonymous"
            className="modal-field-input"
            style={{
                ...inputStyle,
                padding: 0,
                background: "transparent",
                border: "none",
            }}
        />
    </div>
</div>
                                </div>

                                <div
                                    style={{
                                        display: "flex",
                                        flexDirection: "row",
                                        width: "100%",
                                        justifyContent: "flex-end",
                                        background: footerBg,
                                    }}
                                >
                                    <div
                                        style={{
                                            display: "flex",
                                            flexDirection: "row",
                                            width: "50%",
                                        }}
                                    >
                                        <div
                                            onClick={handleClose}
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "flex-start",
                                                flex: 1,
                                                padding: "8px 0",
                                                background: cancelBg,
                                                cursor: "pointer",
                                            }}
                                        >
                                            <span
                                                style={{
                                                    ...labelStyle,
                                                    color: cancelTextColor,
                                                    textAlign: "left",
                                                }}
                                            >
                                                Cancel
                                            </span>
                                        </div>
                                        <div
                                            onClick={handleSubmit}
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "flex-start",
                                                flex: 1,
                                                padding: "8px 0",
                                                gap: 6,
                                                background: pink,
                                                cursor: submitting
                                                    ? "default"
                                                    : !isFormValid
                                                      ? "not-allowed"
                                                      : "pointer",
                                                opacity: submitting
                                                    ? 0.6
                                                    : !isFormValid
                                                      ? 0.4
                                                      : 1,
                                            }}
                                        >
                                            {submitting && (
                                                <LoadingDots
                                                    size={16}
                                                    color={dark}
                                                />
                                            )}
                                            <span style={{ ...labelStyle, color: dark, textAlign: "left" }}>
    {submitting
        ? isEditing
            ? "Saving..."
            : "Submitting..."
        : isEditing
          ? "Save changes"
          : "Submit"}
</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    )
}

// ─── FilterModal ────────────────────────────────────────────────────────────
function FilterModal({
    visible,
    onClose,
    theme,
    activeCategory,
    entries,
    initialType,
    initialGenres,
    initialYear,
    onApply,
}: {
    visible: boolean
    onClose: () => void
    theme: "light" | "dark"
    activeCategory: string
    entries: Entry[]
    initialType: string
    initialGenres: string[]
    initialYear: string
    onApply: (filters: { type: string; genres: string[]; year: string }) => void
}) {
    const font = "'Spline Sans Mono', monospace"
    const pink = "#E298F2"
    const dark = "#1C1C1C"
    const white = "#FEFEFE"

    const modalBg = theme === "light" ? dark : white
    const stackBg = modalBg
    const textColor = theme === "light" ? white : dark
    const rowBg =
        theme === "light" ? "rgba(254, 254, 254, 0.1)" : "rgba(28, 28, 28, 0.1)"
    const rowBorder =
        theme === "light" ? "rgba(254, 254, 254, 0.3)" : "rgba(28, 28, 28, 0.3)"
    const chipBg =
        theme === "light"
            ? "rgba(254, 254, 254, 0.10)"
            : "rgba(28, 28, 28, 0.10)"
    const placeholderColor =
        theme === "light" ? "rgba(254, 254, 254, 0.4)" : "rgba(28, 28, 28, 0.4)"
    const toggleActiveBg = theme === "light" ? white : dark
    const toggleActiveText = theme === "light" ? dark : white
    const cancelBg = theme === "light" ? white : dark
    const cancelTextColor = theme === "light" ? dark : white

    const [types, setTypes] = useState<string[]>(
        initialType ? initialType.split(",").filter(Boolean) : []
    )
    const [genres, setGenres] = useState<string[]>(initialGenres)
    const [genreMenuOpen, setGenreMenuOpen] = useState(false)
    const [genreSearch, setGenreSearch] = useState("")
    const [year, setYear] = useState(initialYear)
    const [yearMenuOpen, setYearMenuOpen] = useState(false)
    const [yearSearch, setYearSearch] = useState("")

    const genreContainerRef = useRef<HTMLDivElement>(null)
    const yearContainerRef = useRef<HTMLDivElement>(null)

    const outerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (visible) {
            setTypes(initialType ? initialType.split(",").filter(Boolean) : [])
            setGenres(initialGenres)
            setYear(initialYear)
        }
    }, [visible, initialType, initialGenres, initialYear])

    const categoryValue = CATEGORY_MAP[activeCategory]

    const availableYears = useMemo(() => {
        const years = new Set<string>()
        entries.forEach((e) => {
            if (e.category === categoryValue && e.release_year) {
                years.add(String(e.release_year))
            }
        })
        return Array.from(years).sort((a, b) => Number(b) - Number(a))
    }, [entries, categoryValue])

    const toggleGenre = (g: string) => {
        setGenres((prev) => {
            if (prev.includes(g)) return prev.filter((x) => x !== g)
            if (prev.length >= 4) return prev
            return [...prev, g]
        })
    }

    const toggleType = (t: string) => {
        setTypes((prev) =>
            prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
        )
    }

    useEffect(() => {
        if (!genreMenuOpen) {
            setGenreSearch("")
            return
        }
        const handleClickOutside = (e: MouseEvent) => {
            if (
                genreContainerRef.current &&
                !genreContainerRef.current.contains(e.target as Node)
            ) {
                setGenreMenuOpen(false)
            }
        }
        document.addEventListener("mousedown", handleClickOutside)
        return () =>
            document.removeEventListener("mousedown", handleClickOutside)
    }, [genreMenuOpen])

    useEffect(() => {
        if (!yearMenuOpen) {
            setYearSearch("")
            return
        }
        const handleClickOutside = (e: MouseEvent) => {
            if (
                yearContainerRef.current &&
                !yearContainerRef.current.contains(e.target as Node)
            ) {
                setYearMenuOpen(false)
            }
        }
        document.addEventListener("mousedown", handleClickOutside)
        return () =>
            document.removeEventListener("mousedown", handleClickOutside)
    }, [yearMenuOpen])

    const handleClose = () => {
        playClickSound()
        onClose()
    }

    const handleReset = () => {
        playClickSound()
        setTypes([])
        setGenres([])
        setYear("")
        onApply({ type: "", genres: [], year: "" })
    }

    const handleDone = () => {
        playClickSound()
        onApply({ type: types.join(","), genres, year })
        onClose()
    }

    useEffect(() => {
        if (!visible) return
        if (typeof document === "undefined") return
        const prevOverflow = document.body.style.overflow
        document.body.style.overflow = "hidden"
        return () => {
            document.body.style.overflow = prevOverflow
        }
    }, [visible])

    const labelStyle: React.CSSProperties = {
        fontFamily: font,
        fontWeight: 500,
        fontSize: 14,
        lineHeight: "17px",
        color: textColor,
    }

    const fieldLabelStyle: React.CSSProperties = {
        ...labelStyle,
        display: "inline-block",
        background: pink,
        color: dark,
        padding: "2px 0px",
        width: "fit-content",
        alignSelf: "flex-start",
    }

    const inputStyle: React.CSSProperties = {
        fontFamily: font,
        fontWeight: 500,
        fontSize: 14,
        lineHeight: "17px",
        color: textColor,
        background: "transparent",
        border: "none",
        outline: "none",
        width: "100%",
        ["--placeholder-color" as any]: placeholderColor,
    }

    const toggleTab = (label: string, active: boolean, onClick: () => void) => (
        <div
            key={label}
            onClick={() => {
                playClickSound()
                onClick()
            }}
            style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                padding: "8px 0px",
                gap: 4,
                flex: 1,
                height: 26,
                background: active ? toggleActiveBg : rowBg,
                cursor: "pointer",
                justifyContent: "flex-start",
            }}
        >
            <span
                style={{
                    ...labelStyle,
                    color: active ? toggleActiveText : textColor,
                }}
            >
                {label}
            </span>
        </div>
    )

    const genreOptionsFiltered = (GENRE_OPTIONS[activeCategory] || []).filter(
        (g) => {
            const normalizedQuery = normalizeSearchText(genreSearch.trim())
            if (!normalizedQuery) return true
            const normalizedGenre = normalizeSearchText(g)
            if (normalizedGenre.includes(normalizedQuery)) return true
            const compactQuery = toCompactSearchText(normalizedQuery)
            const compactGenre = toCompactSearchText(normalizedGenre)
            if (compactQuery && compactGenre.includes(compactQuery)) return true
            return compactQuery
                ? isSubsequenceMatch(compactQuery, compactGenre)
                : false
        }
    )

    const yearOptionsFiltered = availableYears.filter((y) => {
        const normalizedQuery = normalizeSearchText(yearSearch.trim())
        if (!normalizedQuery) return true
        return normalizeSearchText(y).includes(normalizedQuery)
    })
    const hasAnyFilterSelected =
        types.length > 0 || genres.length > 0 || year.trim().length > 0
    const isDropdownOpen = genreMenuOpen || yearMenuOpen
    return (
        <AnimatePresence>
            {visible && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.3 }}
                        onClick={handleClose}
                        style={{
                            position: "fixed",
                            inset: 0,
                            zIndex: 10001,
                            backdropFilter: "blur(8px)",
                            WebkitBackdropFilter: "blur(8px)",
                            pointerEvents: "auto",
                            cursor: "pointer",
                        }}
                    />
                    <motion.div
                        ref={outerRef}
                        initial={{ x: "-100%" }}
                        animate={{ x: 0 }}
                        exit={{ x: "-100%" }}
                        transition={{
                            x: { duration: 0.45, ease: [0.16, 1, 0.3, 1] },
                        }}
                        style={{
                            position: "fixed",
                            left: 8,
                            bottom: 0,
                            width: "50vw",
                            maxWidth: 708,
                            background: "transparent",
                            zIndex: 10002,
                        }}
                    >
                        {/* Title + close button, combined pink pill */}
                        <div
                            onClick={handleClose}
                            style={{
                                display: "flex",
                                flexDirection: "row",
                                justifyContent: "flex-end",
                                alignItems: "center",
                                gap: 8,
                                width: "fit-content",
                                marginLeft: "auto",
                                background: pink,
                                flexShrink: 0,
                                cursor: "pointer",
                            }}
                        >
                            <Icon.Funnel color={dark} />
                            <div
                                style={{
                                    display: "flex",
                                    flexDirection: "row",
                                    justifyContent: "flex-end",
                                    alignItems: "flex-end",
                                    padding: "8px 0px",
                                }}
                            >
                                <span
                                    style={{
                                        ...labelStyle,
                                        fontSize: 14,
                                        color: dark,
                                    }}
                                >
                                    Filters
                                </span>
                            </div>
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    padding: 3,
                                    width: 26,
                                    height: 26,
                                    boxSizing: "border-box",
                                    cursor: "pointer",
                                }}
                            >
                                <svg
                                    width="16"
                                    height="16"
                                    viewBox="0 0 16 16"
                                    fill="none"
                                >
                                    <path
                                        d="M13.0306 11.9695C13.1715 12.1104 13.2506 12.3015 13.2506 12.5007C13.2506 12.7 13.1715 12.8911 13.0306 13.032C12.8897 13.1729 12.6986 13.252 12.4993 13.252C12.3001 13.252 12.109 13.1729 11.9681 13.032L7.99997 9.06261L4.0306 13.0307C3.8897 13.1716 3.69861 13.2508 3.49935 13.2508C3.30009 13.2508 3.10899 13.1716 2.9681 13.0307C2.8272 12.8898 2.74805 12.6987 2.74805 12.4995C2.74805 12.3002 2.8272 12.1091 2.9681 11.9682L6.93747 8.00011L2.96935 4.03073C2.82845 3.88984 2.7493 3.69874 2.7493 3.49948C2.7493 3.30023 2.82845 3.10913 2.96935 2.96823C3.11024 2.82734 3.30134 2.74818 3.5006 2.74818C3.69986 2.74818 3.89095 2.82734 4.03185 2.96823L7.99997 6.93761L11.9693 2.96761C12.1102 2.82671 12.3013 2.74756 12.5006 2.74756C12.6999 2.74756 12.891 2.82671 13.0318 2.96761C13.1727 3.10851 13.2519 3.2996 13.2519 3.49886C13.2519 3.69812 13.1727 3.88921 13.0318 4.03011L9.06247 8.00011L13.0306 11.9695Z"
                                        fill={dark}
                                    />
                                </svg>
                            </div>
                        </div>

                        {/* Panel */}
                        <div
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "flex-start",
                                width: "100%",
                                flex: 1,
                                background: modalBg,
                                overflowY: isDropdownOpen ? "auto" : "hidden",
                                maxHeight: isDropdownOpen
                                    ? "calc(100vh - 24px)"
                                    : undefined,
                                boxSizing: "border-box",
                            }}
                        >
                            {/* Body — input stack and button stack, space-between */}
                            <div
                                style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    justifyContent: isDropdownOpen
                                        ? "flex-start"
                                        : "space-between",
                                    width: "100%",
                                    flex: 1,
                                    overflow: isDropdownOpen
                                        ? "auto"
                                        : "visible",
                                    boxSizing: "border-box",
                                }}
                            >
                                {/* Input stack */}
                                <div
                                    style={{
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: 16,
                                        width: "100%",
                                        boxSizing: "border-box",
                                    }}
                                >
                                    {/* Type */}
                                    <div
                                        style={{
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: 0,
                                        }}
                                    >
                                        <span style={fieldLabelStyle}>
                                            Type
                                        </span>
                                        <div
                                            style={{
                                                display: "grid",
                                                gridTemplateColumns:
                                                    "repeat(3, 1fr)",
                                            }}
                                        >
                                            {(
                                                TYPE_OPTIONS[activeCategory] ||
                                                []
                                            ).map((t) =>
                                                toggleTab(
                                                    t,
                                                    types.includes(t),
                                                    () => toggleType(t)
                                                )
                                            )}
                                        </div>
                                    </div>

                                    {/* Genre — same dropdown logic as NewEntryModal */}
                                    <div
                                        style={{
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: 0,
                                        }}
                                    >
                                        <span style={fieldLabelStyle}>
                                            Genre
                                        </span>
                                        <div
                                            ref={genreContainerRef}
                                            style={{ position: "relative" }}
                                        >
                                            <div
                                                onClick={() =>
                                                    setGenreMenuOpen(
                                                        (prev) => !prev
                                                    )
                                                }
                                                style={{
                                                    display: "flex",
                                                    flexDirection: "row",
                                                    alignItems: "center",
                                                    justifyContent:
                                                        "space-between",
                                                    padding: "16px 0",
                                                    gap: 8,
                                                    height: 50,
                                                    background: rowBg,
                                                    borderBottom: `1px solid ${rowBorder}`,
                                                    cursor: "pointer",
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        display: "flex",
                                                        flexDirection: "row",
                                                        alignItems: "center",
                                                        gap: 8,
                                                        flexWrap: "nowrap",
                                                        overflow: "hidden",
                                                        flex: 1,
                                                    }}
                                                >
                                                    {genres.length === 0 ? (
                                                        <span
                                                            style={{
                                                                ...labelStyle,
                                                                color: placeholderColor,
                                                            }}
                                                        >
                                                            Select genres
                                                        </span>
                                                    ) : (
                                                        genres.map((g) => (
                                                            <div
                                                                key={g}
                                                                style={{
                                                                    display:
                                                                        "flex",
                                                                    flexDirection:
                                                                        "row",
                                                                    alignItems:
                                                                        "center",
                                                                    height: 50,
                                                                    padding:
                                                                        "0 8px",
                                                                    gap: 4,
                                                                    background:
                                                                        chipBg,
                                                                    boxSizing:
                                                                        "border-box",
                                                                    flexShrink: 0,
                                                                }}
                                                            >
                                                                <span
                                                                    style={
                                                                        labelStyle
                                                                    }
                                                                >
                                                                    {g}
                                                                </span>
                                                                <div
                                                                    onClick={(
                                                                        e
                                                                    ) => {
                                                                        e.stopPropagation()
                                                                        playClickSound()
                                                                        toggleGenre(
                                                                            g
                                                                        )
                                                                    }}
                                                                    style={{
                                                                        width: 16,
                                                                        height: 16,
                                                                        display:
                                                                            "flex",
                                                                        alignItems:
                                                                            "center",
                                                                        justifyContent:
                                                                            "center",
                                                                        cursor: "pointer",
                                                                    }}
                                                                >
                                                                    <svg
                                                                        width="14"
                                                                        height="14"
                                                                        viewBox="0 0 16 16"
                                                                        fill="none"
                                                                    >
                                                                        <path
                                                                            d="M13.0306 11.9695C13.1715 12.1104 13.2506 12.3015 13.2506 12.5007C13.2506 12.7 13.1715 12.8911 13.0306 13.032C12.8897 13.1729 12.6986 13.252 12.4993 13.252C12.3001 13.252 12.109 13.1729 11.9681 13.032L7.99997 9.06261L4.0306 13.0307C3.8897 13.1716 3.69861 13.2508 3.49935 13.2508C3.30009 13.2508 3.10899 13.1716 2.9681 13.0307C2.8272 12.8898 2.74805 12.6987 2.74805 12.4995C2.74805 12.3002 2.8272 12.1091 2.9681 11.9682L6.93747 8.00011L2.96935 4.03073C2.82845 3.88984 2.7493 3.69874 2.7493 3.49948C2.7493 3.30023 2.82845 3.10913 2.96935 2.96823C3.11024 2.82734 3.30134 2.74818 3.5006 2.74818C3.69986 2.74818 3.89095 2.82734 4.03185 2.96823L7.99997 6.93761L11.9693 2.96761C12.1102 2.82671 12.3013 2.74756 12.5006 2.74756C12.6999 2.74756 12.891 2.82671 13.0318 2.96761C13.1727 3.10851 13.2519 3.2996 13.2519 3.49886C13.2519 3.69812 13.1727 3.88921 13.0318 4.03011L9.06247 8.00011L13.0306 11.9695Z"
                                                                            fill={
                                                                                textColor
                                                                            }
                                                                        />
                                                                    </svg>
                                                                </div>
                                                            </div>
                                                        ))
                                                    )}
                                                </div>
                                                <Icon.Caret
                                                    color={textColor}
                                                    rotate={
                                                        genreMenuOpen ? 0 : -90
                                                    }
                                                />
                                            </div>

                                            {genreMenuOpen && (
                                                <div
                                                    onWheel={(e) =>
                                                        e.stopPropagation()
                                                    }
                                                    onTouchMove={(e) =>
                                                        e.stopPropagation()
                                                    }
                                                    style={{
                                                        position: "relative",
                                                        zIndex: 10,
                                                        background: modalBg,
                                                        overflow: "visible",
                                                    }}
                                                >
                                                    <div
                                                        style={{
                                                            display: "flex",
                                                            flexDirection:
                                                                "row",
                                                            alignItems:
                                                                "center",
                                                            gap: 8,
                                                            padding: "8px 0",
                                                            position: "sticky",
                                                            top: 0,
                                                            background: modalBg,
                                                            zIndex: 1,
                                                        }}
                                                    >
                                                        <Icon.Search
                                                            color={textColor}
                                                        />
                                                        <input
                                                            value={genreSearch}
                                                            onChange={(e) =>
                                                                setGenreSearch(
                                                                    e.target
                                                                        .value
                                                                )
                                                            }
                                                            onClick={(e) =>
                                                                e.stopPropagation()
                                                            }
                                                            placeholder={`e.g. ${(GENRE_OPTIONS[activeCategory] || []).slice(0, 3).join(", ")}`}
                                                            className="modal-field-input"
                                                            style={{
                                                                ...inputStyle,
                                                                padding: 0,
                                                            }}
                                                        />
                                                    </div>
                                                    <div
                                                        style={{
                                                            maxHeight: 150,
                                                            overflowY: "auto",
                                                        }}
                                                    >
                                                        {genreOptionsFiltered.map(
                                                            (g) => {
                                                                const selected =
                                                                    genres.includes(
                                                                        g
                                                                    )
                                                                const disabled =
                                                                    !selected &&
                                                                    genres.length >=
                                                                        4
                                                                return (
                                                                    <div
                                                                        key={g}
                                                                        onClick={() => {
                                                                            if (
                                                                                disabled
                                                                            )
                                                                                return
                                                                            playClickSound()
                                                                            toggleGenre(
                                                                                g
                                                                            )
                                                                        }}
                                                                        style={{
                                                                            display:
                                                                                "flex",
                                                                            alignItems:
                                                                                "center",
                                                                            padding:
                                                                                "6px 0",
                                                                            background:
                                                                                selected
                                                                                    ? rowBg
                                                                                    : "transparent",
                                                                            cursor: disabled
                                                                                ? "not-allowed"
                                                                                : "pointer",
                                                                            opacity:
                                                                                disabled
                                                                                    ? 0.4
                                                                                    : 1,
                                                                        }}
                                                                    >
                                                                        <span
                                                                            style={
                                                                                labelStyle
                                                                            }
                                                                        >
                                                                            {g}
                                                                        </span>
                                                                    </div>
                                                                )
                                                            }
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Release year — same dropdown logic, single select, options from current entries only */}
                                    <div
                                        style={{
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: 0,
                                        }}
                                    >
                                        <span style={fieldLabelStyle}>
                                            Release year
                                        </span>
                                        <div
                                            ref={yearContainerRef}
                                            style={{ position: "relative" }}
                                        >
                                            <div
                                                onClick={() =>
                                                    setYearMenuOpen(
                                                        (prev) => !prev
                                                    )
                                                }
                                                style={{
                                                    display: "flex",
                                                    flexDirection: "row",
                                                    alignItems: "center",
                                                    justifyContent:
                                                        "space-between",
                                                    padding: "16px 0",
                                                    gap: 8,
                                                    height: 50,
                                                    background: rowBg,
                                                    borderBottom: `1px solid ${rowBorder}`,
                                                    cursor: "pointer",
                                                }}
                                            >
                                                <span
                                                    style={{
                                                        ...labelStyle,
                                                        color: year
                                                            ? textColor
                                                            : placeholderColor,
                                                    }}
                                                >
                                                    {year || "e.g 2016"}
                                                </span>
                                                <Icon.Caret
                                                    color={textColor}
                                                    rotate={
                                                        yearMenuOpen ? 0 : -90
                                                    }
                                                />
                                            </div>

                                            {yearMenuOpen && (
                                                <div
                                                    onWheel={(e) =>
                                                        e.stopPropagation()
                                                    }
                                                    onTouchMove={(e) =>
                                                        e.stopPropagation()
                                                    }
                                                    style={{
                                                        position: "relative",
                                                        zIndex: 10,
                                                        background: modalBg,
                                                        overflow: "visible",
                                                    }}
                                                >
                                                    <div
                                                        style={{
                                                            display: "flex",
                                                            flexDirection:
                                                                "row",
                                                            alignItems:
                                                                "center",
                                                            gap: 8,
                                                            padding: "8px 0",
                                                            position: "sticky",
                                                            top: 0,
                                                            background: modalBg,
                                                            zIndex: 1,
                                                        }}
                                                    >
                                                        <Icon.Search
                                                            color={textColor}
                                                        />
                                                        <input
                                                            value={yearSearch}
                                                            onChange={(e) =>
                                                                setYearSearch(
                                                                    e.target
                                                                        .value
                                                                )
                                                            }
                                                            onClick={(e) =>
                                                                e.stopPropagation()
                                                            }
                                                            placeholder="Search year"
                                                            className="modal-field-input"
                                                            style={{
                                                                ...inputStyle,
                                                                padding: 0,
                                                            }}
                                                        />
                                                    </div>
                                                    <div
                                                        style={{
                                                            maxHeight: 150,
                                                            overflowY: "auto",
                                                        }}
                                                    >
                                                        {yearOptionsFiltered.length ===
                                                        0 ? (
                                                            <div
                                                                style={{
                                                                    padding:
                                                                        "6px 0",
                                                                }}
                                                            >
                                                                <span
                                                                    style={{
                                                                        ...labelStyle,
                                                                        color: placeholderColor,
                                                                    }}
                                                                >
                                                                    No years
                                                                    found
                                                                </span>
                                                            </div>
                                                        ) : (
                                                            yearOptionsFiltered.map(
                                                                (y) => {
                                                                    const selected =
                                                                        year ===
                                                                        y
                                                                    return (
                                                                        <div
                                                                            key={
                                                                                y
                                                                            }
                                                                            onClick={() => {
                                                                                playClickSound()
                                                                                setYear(
                                                                                    selected
                                                                                        ? ""
                                                                                        : y
                                                                                )
                                                                                setYearMenuOpen(
                                                                                    false
                                                                                )
                                                                            }}
                                                                            style={{
                                                                                display:
                                                                                    "flex",
                                                                                alignItems:
                                                                                    "center",
                                                                                padding:
                                                                                    "10px 0",
                                                                                background:
                                                                                    selected
                                                                                        ? rowBg
                                                                                        : "transparent",
                                                                                cursor: "pointer",
                                                                            }}
                                                                        >
                                                                            <span
                                                                                style={
                                                                                    labelStyle
                                                                                }
                                                                            >
                                                                                {
                                                                                    y
                                                                                }
                                                                            </span>
                                                                        </div>
                                                                    )
                                                                }
                                                            )
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Button stack */}
                                <div
                                    style={{
                                        display: "flex",
                                        flexDirection: "row",
                                        width: "50%",
                                        alignSelf: "flex-start",
                                        flexShrink: 0,
                                    }}
                                >
                                    {hasAnyFilterSelected && (
                                        <div
                                            onClick={handleReset}
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "flex-start",
                                                flex: 1,
                                                padding: "8px 0",
                                                background: cancelBg,
                                                cursor: "pointer",
                                            }}
                                        >
                                            <span
                                                style={{
                                                    ...labelStyle,
                                                    color: cancelTextColor,
                                                }}
                                            >
                                                Reset
                                            </span>
                                        </div>
                                    )}
                                    <div
                                        onClick={
                                            hasAnyFilterSelected
                                                ? handleDone
                                                : undefined
                                        }
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "flex-start",
                                            flex: 1,
                                            padding: "8px 0",
                                            background: pink,
                                            cursor: hasAnyFilterSelected
                                                ? "pointer"
                                                : "not-allowed",
                                            opacity: hasAnyFilterSelected
                                                ? 1
                                                : 0.4,
                                        }}
                                    >
                                        <span
                                            style={{
                                                ...labelStyle,
                                                color: dark,
                                            }}
                                        >
                                            Done
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    )
}

// ─── InfoModal ──────────────────────────────────────────────────────────────
function InfoModal({
    visible,
    onClose,
    theme,
}: {
    visible: boolean
    onClose: () => void
    theme: "light" | "dark"
}) {
    const font = "'Spline Sans Mono', monospace"
    const pink = "#E298F2"
    const dark = "#1C1C1C"
    const white = "#FEFEFE"

    const modalBg = theme === "light" ? dark : white
    const textColor = theme === "light" ? white : dark

    const labelStyle: React.CSSProperties = {
        fontFamily: font,
        fontWeight: 500,
        fontSize: 14,
        lineHeight: "17px",
        color: textColor,
    }

    const handleClose = () => {
        playClickSound()
        onClose()
    }

    useEffect(() => {
        if (!visible) return
        if (typeof document === "undefined") return
        const prevOverflow = document.body.style.overflow
        document.body.style.overflow = "hidden"
        return () => {
            document.body.style.overflow = prevOverflow
        }
    }, [visible])

    return (
        <AnimatePresence>
            {visible && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.3 }}
                        onClick={handleClose}
                        style={{
                            position: "fixed",
                            inset: 0,
                            zIndex: 10001,
                            backdropFilter: "blur(8px)",
                            WebkitBackdropFilter: "blur(8px)",
                            pointerEvents: "auto",
                            cursor: "pointer",
                        }}
                    />
                    <motion.div
                        initial={{ x: "100%" }}
                        animate={{ x: 0 }}
                        exit={{ x: "100%" }}
                        transition={{
                            duration: 0.45,
                            ease: [0.16, 1, 0.3, 1],
                        }}
                        style={{
                            position: "fixed",
                            right: 8,
                            bottom: 78,
                            width: "50vw",
                            maxWidth: 708,
                            height: "calc(50vh - 78px)",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "flex-end",
                            zIndex: 10002,
                        }}
                    >
                        {/* Title + close button, combined pink pill */}
                        <div
                            onClick={handleClose}
                            style={{
                                display: "flex",
                                flexDirection: "row",
                                justifyContent: "flex-end",
                                alignItems: "center",
                                gap: 8,
                                width: "fit-content",
                                marginLeft: "auto",
                                background: pink,
                                flexShrink: 0,
                                cursor: "pointer",
                            }}
                        >
                            <div
                                style={{
                                    display: "flex",
                                    flexDirection: "row",
                                    justifyContent: "flex-end",
                                    alignItems: "flex-end",
                                    padding: "8px 0px",
                                }}
                            >
                                <span
                                    style={{
                                        ...labelStyle,
                                        fontSize: 14,
                                        color: dark,
                                    }}
                                >
                                    Info
                                </span>
                            </div>
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    padding: 3,
                                    width: 26,
                                    height: 26,
                                    boxSizing: "border-box",
                                    cursor: "pointer",
                                }}
                            >
                                <svg
                                    width="16"
                                    height="16"
                                    viewBox="0 0 16 16"
                                    fill="none"
                                >
                                    <path
                                        d="M13.0306 11.9695C13.1715 12.1104 13.2506 12.3015 13.2506 12.5007C13.2506 12.7 13.1715 12.8911 13.0306 13.032C12.8897 13.1729 12.6986 13.252 12.4993 13.252C12.3001 13.252 12.109 13.1729 11.9681 13.032L7.99997 9.06261L4.0306 13.0307C3.8897 13.1716 3.69861 13.2508 3.49935 13.2508C3.30009 13.2508 3.10899 13.1716 2.9681 13.0307C2.8272 12.8898 2.74805 12.6987 2.74805 12.4995C2.74805 12.3002 2.8272 12.1091 2.9681 11.9682L6.93747 8.00011L2.96935 4.03073C2.82845 3.88984 2.7493 3.69874 2.7493 3.49948C2.7493 3.30023 2.82845 3.10913 2.96935 2.96823C3.11024 2.82734 3.30134 2.74818 3.5006 2.74818C3.69986 2.74818 3.89095 2.82734 4.03185 2.96823L7.99997 6.93761L11.9693 2.96761C12.1102 2.82671 12.3013 2.74756 12.5006 2.74756C12.6999 2.74756 12.891 2.82671 13.0318 2.96761C13.1727 3.10851 13.2519 3.2996 13.2519 3.49886C13.2519 3.69812 13.1727 3.88921 13.0318 4.03011L9.06247 8.00011L13.0306 11.9695Z"
                                        fill={dark}
                                    />
                                </svg>
                            </div>
                        </div>

                        {/* Panel */}
                        <div
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "flex-start",
                                gap: 8,
                                width: "100%",
                                flex: 1,
                                background: modalBg,
                                overflow: "hidden",
                                boxSizing: "border-box",
                            }}
                        >
                            {/* Body */}
                            <div
                                style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    justifyContent: "space-between",
                                    alignItems: "flex-start",
                                    padding: "4px 0",
                                    gap: 8,
                                    width: "100%",
                                    flex: 1,
                                    boxSizing: "border-box",
                                }}
                            >
                                <p
                                    style={{
                                        ...labelStyle,
                                        margin: 0,
                                    }}
                                >
                                    No algorithm. No ads. Just real people
                                    sharing what they're actually watching,
                                    listening to, and reading. This is a
                                    community directory. See what others like
                                    and find something new. If you have
                                    something worth sharing, feel free to add
                                    it. Leave a comment and include a link. Your
                                    recommendations are welcome here alongside
                                    everyone else's; no account needed, no
                                    gatekeeping. The best recommendations come
                                    from people, not machines. This is that.
                                </p>
                                <span style={labelStyle}>
                                    Designed and built by{" "}
                                    <a
                                        href="https://dee-space03.framer.website/"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        style={{
                                            ...labelStyle,
                                            opacity: 0.4,
                                            textDecoration: "underline",
                                        }}
                                    >
                                        Hamdiya
                                    </a>
                                </span>
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    )
}

// ─── EntryDetailModal ───────────────────────────────────────────────────────
function EntryDetailModal({
    visible,
    onClose,
    theme,
    entry,
    activeCategory,
    contrast,
    holeSize,
    bookWidth,
    spineWidth,
    bookBorderRadius,
    textureImg,
    textureOpacity,
    onCursorHoverChange,
    onEdit,
    onDelete,
}: {
    visible: boolean
    onClose: () => void
    theme: "light" | "dark"
    entry: Entry | null
    activeCategory: string
    contrast: number
    holeSize: number
    bookWidth: number
    spineWidth: number
    bookBorderRadius: number
    textureImg?: string
    textureOpacity: number
    onCursorHoverChange?: (hovering: boolean) => void
    onEdit?: (entry: Entry) => void
    onDelete?: (entry: Entry) => void
}) {
    const font = "'Spline Sans Mono', monospace"
    const pink = "#E298F2"
    const dark = "#1C1C1C"
    const white = "#FEFEFE"

    // Theme-aware colors — flips with app theme like the rest of the modals
    const panelBg = theme === "light" ? dark : white
const textColor = theme === "light" ? white : dark

const themedTextColor = theme === "light" ? dark : white
const mutedThemedTextColor =
    theme === "light" ? "rgba(28,28,28,0.55)" : "rgba(254,254,254,0.55)"
const inactiveToggleBg =
    theme === "light" ? "rgba(28, 28, 28, 0.06)" : "rgba(254, 254, 254, 0.10)"

    const chipTextStyle: React.CSSProperties = {
        fontFamily: font,
        fontWeight: 500,
        fontSize: 14,
        lineHeight: "17px",
        display: "flex",
        alignItems: "center",
    }

    const [closing, setClosing] = useState(false)

    useEffect(() => {
        if (visible) setClosing(false)
    }, [visible])

    const handleClose = () => {
        playClickSound()
        if (activeCategory === "Film") {
            setClosing(true)
            window.setTimeout(() => {
                onClose()
            }, 500)
        } else {
            onClose()
        }
    }

    useEffect(() => {
        if (!visible) return
        if (typeof document === "undefined") return
        const prevOverflow = document.body.style.overflow
        document.body.style.overflow = "hidden"
        return () => {
            document.body.style.overflow = prevOverflow
        }
    }, [visible])

    const previewAudioRef = useRef<HTMLAudioElement | null>(null)

    useEffect(() => {
        if (!visible || activeCategory !== "Music" || !entry) return

        let cancelled = false
        let audio: HTMLAudioElement | null = null
        let startTimeout: number | undefined
        let fadeInterval: number | undefined

        const startPreview = (url: string) => {
            audio = new Audio(url)
            audio.muted = true
            audio.volume = 0
            audio.loop = true
            previewAudioRef.current = audio

            // Start muted immediately — browsers allow this without a fresh
            // user gesture, unlike unmuted autoplay, which gets silently blocked.
            audio.play().catch((err) => {
                console.error("Preview audio play() failed:", err, url)
            })

            audio.addEventListener("error", () => {
                console.error(
                    "Preview audio failed to load — the URL must be a direct audio file (.mp3, .m4a, .wav), not a share/embed link:",
                    url,
                    audio?.error
                )
                if (previewAudioRef.current === audio)
                    previewAudioRef.current = null
            })

            startTimeout = window.setTimeout(() => {
                if (audio) audio.muted = false
                let vol = 0
                fadeInterval = window.setInterval(() => {
                    vol = Math.min(0.6, vol + 0.05)
                    if (audio) audio.volume = vol
                    if (vol >= 0.6 && fadeInterval) clearInterval(fadeInterval)
                }, 50)
            }, 900)
        }

        if (entry.subcategory === "curated_playlist") {
            if (entry.preview_url) {
                fetch(
                    `https://open.spotify.com/oembed?url=${encodeURIComponent(entry.preview_url)}`
                )
                    .then((res) => res.json())
                    .then((data) => {
                        if (cancelled || !data?.title) return
                        return fetchItunesPreviewUrl(
                            data.title,
                            entry.creator_name
                        )
                    })
                    .then((url) => {
                        if (cancelled || !url) return
                        startPreview(url)
                    })
                    .catch(() => {})
            }
        } else {
            fetchItunesPreviewUrl(entry.title, entry.creator_name).then(
                (url) => {
                    if (cancelled || !url) return
                    startPreview(url)
                }
            )
        }

        return () => {
            cancelled = true
            if (startTimeout) clearTimeout(startTimeout)
            if (fadeInterval) clearInterval(fadeInterval)
            audio?.pause()
            if (audio) audio.currentTime = 0
            previewAudioRef.current = null
        }
    }, [visible, entry, activeCategory])

    if (!entry) return null

    const img = entryToImageItem(entry)
    const typeLabel = toTitleCaseLabel(entry.subcategory ?? "")
    const genres = (entry.genre ?? "").split(",").filter(Boolean)
    const isMine = getMyEntryIds().includes(entry.id)

    return (
        <AnimatePresence>
            {visible && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: closing ? 0 : 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                        onClick={handleClose}
                        onMouseEnter={() => onCursorHoverChange?.(true)}
                        onMouseLeave={() => onCursorHoverChange?.(false)}
                        style={{
                            position: "fixed",
                            inset: 0,
                            zIndex: 9998,
                            background:
                                theme === "light"
                                    ? "rgba(254, 254, 254, 0.6)"
                                    : "rgba(28, 28, 28, 0.6)",
                            backdropFilter: "blur(15px)",
                            WebkitBackdropFilter: "blur(15px)",
                            pointerEvents: "auto",
                            cursor: "none",
                        }}
                    />
                    <div
                        style={{
                            position: "fixed",
                            left: "50%",
                            top: "50%",
                            transform: "translate(-50%, -50%)",
                            width: "fit-content",
                            zIndex: 9999,
                            pointerEvents: "none",
                        }}
                    >
                        <motion.div
                            initial={{ scale: 0.92, opacity: 0 }}
                            animate={{
                                scale: closing ? 0.97 : 1,
                                opacity: closing ? 0 : 1,
                            }}
                            exit={{ scale: 0.92, opacity: 0 }}
                            transition={{
                                duration: 0.4,
                                ease: [0.16, 1, 0.3, 1],
                            }}
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "flex-end",
                                pointerEvents: "none",
                            }}
                        >
                            {/* Panel */}
                            <motion.div
                                animate={{ opacity: closing ? 0 : 1 }}
                                transition={{
                                    duration: 0.4,
                                    ease: [0.16, 1, 0.3, 1],
                                }}
                                onClick={handleClose}
                                style={{
                                    position: "relative",
                                    display: "flex",
                                    flexDirection: "row",
                                    justifyContent: "center",
                                    alignItems: "center",
                                    width: 1186,
                                    maxWidth: "90vw",
                                    gap: 127,
                                    padding: 32,
                                    boxSizing: "border-box",
                                    pointerEvents: "none",
                                }}
                            >
                                {/* Cover art, left */}
                                <div
                                    style={{
                                        position: "relative",
                                        flexShrink: 0,
                                        width: 589,
                                        height:
                                            activeCategory === "Film"
                                                ? 360 *
                                                  (DVD_CASE_HEIGHT /
                                                      DVD_CASE_WIDTH)
                                                : 374.09,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                    }}
                                >
                                    {activeCategory === "Music" ? (
                                        <motion.div
                                            layoutId={`cover-${entry.id}`}
                                            transition={{
                                                duration: 0.5,
                                                ease: [0.16, 1, 0.3, 1],
                                            }}
                                            style={{
                                                position: "relative",
                                                width: "100%",
                                                height: "100%",
                                            }}
                                        >
                                            <div
                                                style={{
                                                    transform: "scale(2.9)",
                                                    transformOrigin: "center",
                                                }}
                                            >
                                                <Vinyl3DViewer
                                                    coverImageUrl={img.src}
                                                    width={589}
                                                    height={374.09}
                                                />
                                            </div>
                                        </motion.div>
                                    ) : activeCategory === "Books" ? (
                                        <motion.div
                                            layoutId={`cover-${entry.id}`}
                                            transition={{
                                                duration: 0.5,
                                                ease: [0.16, 1, 0.3, 1],
                                            }}
                                            style={{
                                                position: "relative",
                                                width: "100%",
                                                height: "100%",
                                            }}
                                        >
                                            <div
                                                style={{
                                                    transform: "scale(2.0)",
                                                    transformOrigin: "center",
                                                }}
                                            >
                                                <Book3DViewer
                                                    coverImageUrl={img.src}
                                                    width={589}
                                                    height={374.09}
                                                />
                                            </div>
                                        </motion.div>
                                    ) : activeCategory === "Film" ? (
                                        <motion.div
                                            layoutId={`cover-${entry.id}`}
                                            transition={{
                                                duration: 0.5,
                                                ease: [0.16, 1, 0.3, 1],
                                            }}
                                            style={{
                                                position: "relative",
                                                width: 320,
                                                height:
                                                    320 *
                                                    (DVD_CASE_HEIGHT /
                                                        DVD_CASE_WIDTH),
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                            }}
                                        >
                                            <div
                                                style={{
                                                    transform: "scale(1.9)",
                                                    transformOrigin: "center",
                                                }}
                                            >
                                                <Film3DViewer
                                                    coverImageUrl={img.src}
                                                    width={320}
                                                    height={
                                                        320 *
                                                        (DVD_CASE_HEIGHT /
                                                            DVD_CASE_WIDTH)
                                                    }
                                                />
                                            </div>
                                        </motion.div>
                                    ) : (
                                        img.src && (
                                            <motion.img
                                                layoutId={`cover-${entry.id}`}
                                                transition={{
                                                    duration: 0.5,
                                                    ease: [0.16, 1, 0.3, 1],
                                                }}
                                                src={img.src}
                                                alt={img.alt || ""}
                                                style={{
                                                    width: "100%",
                                                    height: "100%",
                                                    objectFit: "cover",
                                                    borderRadius: 999,
                                                    filter: `contrast(${contrast}%)`,
                                                }}
                                            />
                                        )
                                    )}
                                </div>

                                {/* Text content stack */}
                                <div
                                    style={{
                                        display: "flex",
                                        flexDirection: "column",
                                        alignItems: "flex-start",
                                        width: 470,
                                        gap: 40,
                                        zIndex: 1,
                                    }}
                                >
                                    {/* type/title/creator/genre/year stack, no gap */}
                                    <div
                                        style={{
                                            display: "flex",
                                            flexDirection: "column",
                                            justifyContent: "center",
                                            alignItems: "flex-start",
                                            width: "fit-content",
                                        }}
                                    >
                                        
{img.title && (
    <div
        style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            padding: "4px 0px",
        }}
    >
        <span
            style={{
                ...chipTextStyle,
                color: themedTextColor,
            }}
        >
            {img.title}
        </span>
    </div>
)}
{img.creatorName && (
    <div
        style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            padding: "4px 0px",
        }}
    >
        <span
            style={{
                ...chipTextStyle,
                color: themedTextColor,
            }}
        >
            {img.creatorName}
        </span>
    </div>
)}
{typeLabel && (
    <div
        style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            padding: "4px 0px",
        }}
    >
        <span
            style={{
                ...chipTextStyle,
                color: mutedThemedTextColor,
            }}
        >
            {typeLabel}
        </span>
    </div>
)}
{genres.length > 0 && (
    <div
        style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "flex-start",
            gap: 8,
        }}
    >
        {genres.map((g, i) => (
            <div
                key={g}
                style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    padding: "4px 0px",
                    gap: 8,
                }}
            >
                <span
                    style={{
                        ...chipTextStyle,
                        color: mutedThemedTextColor,
                    }}
                >
                    {g}
                </span>
                {i < genres.length - 1 && (
                    <span
                        style={{
                            ...chipTextStyle,
                            color: mutedThemedTextColor,
                        }}
                    >
                        /
                    </span>
                )}
            </div>
        ))}
    </div>
)}
{img.releaseYear && (
    <div
        style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            padding: "4px 0px",
        }}
    >
        <span
            style={{
                ...chipTextStyle,
                color: mutedThemedTextColor,
            }}
        >
            {img.releaseYear}
        </span>
    </div>
)}
                                    </div>

                                    {(entry.comment || img.posterName) && (
                                        <div
                                            style={{
                                                display: "flex",
                                                flexDirection: "column",
                                                alignItems: "flex-start",
                                                gap: 8,
                                            }}
                                        >
                                            {entry.comment && (
                                                <p
                                                    style={{
                                                        margin: 0,
                                                        width: 454,
                                                        ...chipTextStyle,
                                                        color: panelBg,
                                                    }}
                                                >
                                                    "{entry.comment}"
                                                </p>
                                            )}
                                            {img.posterName && (
    <span
        style={{
            ...chipTextStyle,
            color: mutedThemedTextColor,
        }}
    >
        Added by @{img.posterName}
    </span>
)}
                                        </div>
                                    )}

                                    {(img.externalLink || isMine) && (
    <div
        style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
        }}
    >
        {img.externalLink && (
            <a
                href={img.externalLink}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                    e.stopPropagation()
                    playClickSound()
                }}
                onMouseEnter={() =>
                    onCursorHoverChange?.(false)
                }
                onMouseLeave={() =>
                    onCursorHoverChange?.(true)
                }
                style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "8px 24px 8px 0px",
                    gap: 8,
                    width: "fit-content",
                    height: 26,
                    background: pink,
                    textDecoration: "none",
                    pointerEvents: "auto",
                    cursor: "pointer",
                }}
            >
                <span
                    style={{
                        fontFamily: font,
                        fontWeight: 500,
                        fontSize: 14,
                        lineHeight: "17px",
                        color: dark,
                    }}
                >
                    {getActionLabel(activeCategory)}
                </span>
            </a>
        )}
        {isMine && (
            <div
                onClick={(e) => {
                    e.stopPropagation()
                    playClickSound()
                    onEdit?.(entry)
                }}
                onMouseEnter={() => onCursorHoverChange?.(false)}
                onMouseLeave={() => onCursorHoverChange?.(true)}
                style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "flex-start",
                    padding: "8px 24px 8px 0px",
                    gap: 8,
                    width: "fit-content",
                    height: 26,
                    background: inactiveToggleBg,
                    boxSizing: "border-box",
                    cursor: "pointer",
                    pointerEvents: "auto",
                }}
            >
                <span
                    style={{
                        ...chipTextStyle,
                        color: themedTextColor,
                    }}
                >
                    Edit
                </span>
            </div>
        )}
        {isMine && (
            <div
                onClick={(e) => {
                    e.stopPropagation()
                    playClickSound()
                    onDelete?.(entry)
                }}
                onMouseEnter={() => onCursorHoverChange?.(false)}
                onMouseLeave={() => onCursorHoverChange?.(true)}
                style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "flex-start",
                    padding: "8px 24px 8px 0px",
                    gap: 8,
                    width: "fit-content",
                    height: 26,
                    background: inactiveToggleBg,
                    boxSizing: "border-box",
                    cursor: "pointer",
                    pointerEvents: "auto",
                }}
            >
                <span
                    style={{
                        ...chipTextStyle,
                        color: themedTextColor,
                    }}
                >
                    Delete
                </span>
            </div>
        )}
    </div>
)}

                                </div>
                            </motion.div>
                        </motion.div>
                    </div>
                </>
            )}
        </AnimatePresence>
    )
}

interface GridCellProps {
    id: string
    col: number
    row: number
    tileW: number
    tileH: number
    leftPx: number
    topPx: number
    img: ImageItem
    isMatched: boolean
    isHovered: boolean
    isDragging: boolean
    isClicked: boolean
    entryOpen: boolean
    delay: number
    hoverScale: number
    dragScale: number
    blurIntensity: number
    borderRadius: number
    activeCategory: string
    cellDisplayWidth: number
    cellDisplayHeight: number
    effWidth: number
    effHeight: number
    effSpineDepth: number
    bookWidth: number
    filmWidth: number
    cellSize: number
    contrast: number
    shadowIntensity: number
    noiseEnabled: boolean
    noiseSize: number
    noiseOpacity: number
    noiseBlend: string
    musicTextureImg?: string
    musicTextureOpacity: number
    musicTextureBlend: string
    spineWidth: number
    bookBorderRadius: number
    textureImg?: string
    textureOpacity: number
    bookTextureBlend: string
    filmSpineWidth: number
    filmBorderRadius: number
    filmTextureImg?: string
    filmTextureOpacity: number
    filmTextureBlend: string
    spineColor: string
    filmSpineColor: string
    showInfoOnHover: boolean
    infoFontSize: number
    infoBgColor: string
    infoBgTextColor: string
    containerRef: React.RefObject<HTMLDivElement | null>
    onCellClick: (id: string, entryId: string) => void
    onCellHoverStart: (id: string) => void
    onCellHoverEnd: (id: string) => void
    onActionHover: (hovering: boolean) => void
}

const GridCell = memo(function GridCell({
    id,
    col,
    row,
    tileW,
    tileH,
    leftPx,
    topPx,
    img,
    isMatched,
    isHovered,
    isDragging,
    isClicked,
    entryOpen,
    delay,
    hoverScale,
    dragScale,
    blurIntensity,
    borderRadius,
    activeCategory,
    cellDisplayWidth,
    cellDisplayHeight,
    effWidth,
    effHeight,
    effSpineDepth,
    bookWidth,
    filmWidth,
    cellSize,
    contrast,
    shadowIntensity,
    noiseEnabled,
    noiseSize,
    noiseOpacity,
    noiseBlend,
    musicTextureImg,
    musicTextureOpacity,
    musicTextureBlend,
    spineWidth,
    bookBorderRadius,
    textureImg,
    textureOpacity,
    bookTextureBlend,
    filmSpineWidth,
    filmBorderRadius,
    filmTextureImg,
    filmTextureOpacity,
    filmTextureBlend,
    spineColor,
    filmSpineColor,
    showInfoOnHover,
    infoFontSize,
    infoBgColor,
    infoBgTextColor,
    containerRef,
    onCellClick,
    onCellHoverStart,
    onCellHoverEnd,
    onActionHover,
}: GridCellProps) {
    const cellRef = useRef<HTMLDivElement>(null)
    const [infoFlipped, setInfoFlipped] = useState(false)

    const infoVisible = isHovered && !isDragging
    const hasInfo =
    showInfoOnHover &&
    isMatched &&
    !!(
        img.title ||
        img.type ||
        img.releaseYear ||
        img.creatorName ||
        img.posterName
    )

const mutedInfoTextColor =
    infoBgColor === "#FEFEFE"
        ? "rgba(254,254,254,0.55)"
        : "rgba(28,28,28,0.55)"

    const shapeOverflow =
        activeCategory === "Books"
            ? Math.max(0, (bookWidth - cellSize) / 2)
            : activeCategory === "Film"
              ? Math.max(0, (filmWidth - cellSize) / 2)
              : 0
    const infoGap = activeCategory === "Books" ? 16 : 24
    const infoHiddenGap = activeCategory === "Books" ? 8 : 16
    const infoVisibleOffset = shapeOverflow + infoGap
    const infoHiddenOffset = shapeOverflow + infoHiddenGap
    const infoTransform = infoVisible
        ? `translate(${infoFlipped ? "-" : ""}${infoVisibleOffset}px, -50%) scale(${1 / hoverScale})`
        : `translate(${infoFlipped ? "-" : ""}${infoHiddenOffset}px, -50%) scale(${0.92 / hoverScale})`

    const handleMouseEnter = () => {
        if (!isMatched) return
        onCellHoverStart(id)
        const target = cellRef.current
        const container = containerRef.current
        if (target && container) {
            const targetRect = target.getBoundingClientRect()
            const containerRect = container.getBoundingClientRect()
            const spaceRight = containerRect.right - targetRect.right
            setInfoFlipped(spaceRight < 220)
        }
    }

    return (
        <motion.div
            ref={cellRef}
            initial={{ x: CONVERGE_X, y: CONVERGE_Y, scale: 0.15, opacity: 0 }}
            animate={{
                x: 0,
                y: 0,
                scale: isDragging
                    ? dragScale
                    : isHovered
                      ? hoverScale
                      : isMatched
                        ? 1
                        : 0.9,
                opacity: isClicked && entryOpen ? 0 : isMatched ? 1 : 0.2,
            }}
            exit={{
                x: CONVERGE_X,
                y: CONVERGE_Y,
                scale: 0.15,
                opacity: 0,
                transition: { duration: 0.45, delay, ease: [0.4, 0, 0.2, 1] },
            }}
            transition={{
                x: { duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] },
                y: { duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] },
                scale: isDragging
                    ? { duration: 0.12, ease: [0.16, 1, 0.3, 1] }
                    : { type: "spring", stiffness: 420, damping: 26 },
                opacity: { duration: 0.4, delay },
            }}
            style={{
                position: "absolute",
                left: leftPx,
                top: topPx,
                width: cellDisplayWidth,
                height: cellDisplayHeight,
                userSelect: "none",
                zIndex: isHovered ? 10 : 1,
                cursor: isMatched ? "none" : "default",
                pointerEvents: isMatched ? "auto" : "none",
                filter: isMatched
                    ? "blur(0px) saturate(1) grayscale(0)"
                    : `blur(${blurIntensity}px) saturate(0.35) grayscale(1)`,
            }}
            onClick={() => {
                if (!isMatched || isDragging) return
                onCellClick(id, img.entryId)
            }}
            onHoverStart={handleMouseEnter}
            onHoverEnd={() => {
                if (!isMatched) return
                onCellHoverEnd(id)
            }}
        >
            <motion.div
                layoutId={isClicked ? `cover-${img.entryId}` : undefined}
                style={{
                    position: "relative",
                    width: "100%",
                    height: "100%",
                    transformStyle: "preserve-3d",
                    transformPerspective: 1200,
                    rotateY: 30,
                    rotateX: -10,
                    ...(activeCategory !== "Books" &&
                        activeCategory !== "Film" && { borderRadius }),
                    overflow: "visible",
                }}
                transition={{
                    rotateX: { type: "spring", stiffness: 300, damping: 30 },
                    rotateY: { type: "spring", stiffness: 300, damping: 30 },
                }}
            >
                {/* FRONT FACE */}
                <div
                    style={{
                        position: "absolute",
                        ...(activeCategory === "Books"
                            ? {
                                  top: "50%",
                                  left: "50%",
                                  width: effWidth + bookWidth * 0.04,
                                  height: effHeight + bookWidth * 0.04,
                                  marginLeft:
                                      -(effWidth + bookWidth * 0.04) / 2,
                                  marginTop:
                                      -(effHeight + bookWidth * 0.04) / 2,
                              }
                            : { inset: 0 }),
                        transform: `translateZ(${effSpineDepth / 2}px)`,
                        ...(activeCategory !== "Books" &&
                            activeCategory !== "Film" && { borderRadius }),
                        overflow:
                            activeCategory === "Books" ||
                            activeCategory === "Film"
                                ? "visible"
                                : "hidden",
                    }}
                >
                    {activeCategory === "Film" ? (
                        <DVDCaseThumbnail
                            size={filmWidth}
                            img={img.src}
                            contrast={contrast}
                            spineWidth={filmSpineWidth}
                            borderRadius={filmBorderRadius}
                            textureImg={filmTextureImg}
                            textureOpacity={filmTextureOpacity}
                            textureBlend={filmTextureBlend}
                        />
                    ) : activeCategory === "Books" ? (
                        <BookCover
                            size={bookWidth}
                            img={img.src}
                            contrast={contrast}
                            spineWidth={spineWidth}
                            borderRadius={bookBorderRadius}
                            textureImg={textureImg}
                            textureOpacity={textureOpacity}
                            textureBlend={bookTextureBlend}
                        />
                    ) : (
                        <VinylSleeve
                            size={cellSize}
                            img={img.src}
                            contrast={contrast}
                            borderRadius={borderRadius}
                            shadowIntensity={shadowIntensity}
                            noiseEnabled={noiseEnabled}
                            noiseSize={noiseSize}
                            noiseOpacity={noiseOpacity}
                            noiseBlend={noiseBlend}
                            textureImg={musicTextureImg}
                            textureOpacity={musicTextureOpacity}
                            textureBlend={musicTextureBlend}
                        />
                    )}
                </div>

                {/* BACK FACE — hardcover board */}
                {activeCategory === "Books" && (
                    <div
                        style={{
                            position: "absolute",
                            top: "50%",
                            left: "50%",
                            width: effWidth + bookWidth * 0.04,
                            height: effHeight + bookWidth * 0.04,
                            marginLeft: -(effWidth + bookWidth * 0.04) / 2,
                            marginTop: -(effHeight + bookWidth * 0.04) / 2,
                            backgroundColor: spineColor,
                            borderRadius: bookBorderRadius,
                            backfaceVisibility: "hidden",
                            WebkitBackfaceVisibility: "hidden",
                            transform: `rotateY(180deg) translateZ(${effSpineDepth / 2}px)`,
                        }}
                    >
                        <div
                            style={{
                                position: "absolute",
                                inset: 0,
                                background: "rgba(0,0,0,0.15)",
                                borderRadius: bookBorderRadius,
                            }}
                        />
                    </div>
                )}

                {/* SPINE FACE */}
                <div
                    style={{
                        position: "absolute",
                        top: "50%",
                        left: "50%",
                        width: effSpineDepth,
                        height: effHeight,
                        marginLeft: -effSpineDepth / 2,
                        marginTop: -effHeight / 2,
                        backgroundColor:
                            activeCategory === "Film"
                                ? filmSpineColor
                                : spineColor,
                        transform: `rotateY(-90deg) translateZ(${effWidth / 2}px)`,
                        backfaceVisibility: "hidden",
                        overflow: "hidden",
                    }}
                >
                    {activeCategory === "Film" && img.src && (
                        <div
                            style={{
                                position: "absolute",
                                left: 0,
                                right: 0,
                                top: 8 * (effWidth / DVD_CASE_WIDTH),
                                bottom: 8 * (effWidth / DVD_CASE_WIDTH),
                                backgroundImage: `url(${img.src})`,
                                backgroundSize: `${effWidth}px ${effHeight - 2 * (8 * (effWidth / DVD_CASE_WIDTH))}px`,
                                backgroundPosition: "left center",
                                backgroundRepeat: "no-repeat",
                            }}
                        />
                    )}
                    {activeCategory === "Music" && img.src && (
    <div
        style={{
            position: "absolute",
            inset: 0,
            backgroundImage: `url(${img.src})`,
            backgroundSize: `${effWidth}px ${effHeight}px`,
            backgroundPosition: "left center",
            backgroundRepeat: "no-repeat",
        }}
    />
)}
                    <div
                        style={{
                            position: "absolute",
                            inset: 0,
                            background: "rgba(0,0,0,0.35)",
                        }}
                    />
                </div>

                {/* TOP FACE */}
                <div
                    style={{
                        position: "absolute",
                        top: "50%",
                        left: "50%",
                        width:
                            activeCategory === "Books"
                                ? effWidth - bookWidth * 0.04
                                : effWidth,
                        height: effSpineDepth,
                        marginLeft:
                            activeCategory === "Books"
                                ? -(effWidth - bookWidth * 0.04) / 2
                                : -effWidth / 2,
                        marginTop: -effSpineDepth / 2,
                        backgroundColor:
                            activeCategory === "Books"
                                ? "#F8F5EC"
                                : activeCategory === "Film"
                                  ? "#050505"
                                  : spineColor,
                        transform: `rotateX(90deg) translateZ(${effHeight / 2}px)`,
                        backfaceVisibility: "hidden",
                    }}
                >
                    <div
                        style={{
                            position: "absolute",
                            inset: 0,
                            background:
                                activeCategory === "Books"
                                    ? "rgba(0,0,0,0.08)"
                                    : "rgba(0,0,0,0.15)",
                        }}
                    />
                </div>
            </motion.div>

            {hasInfo && (
                <div
                    style={{
                        position: "absolute",
                        top: "50%",
                        ...(infoFlipped ? { right: "100%" } : { left: "100%" }),
                        display: "flex",
                        flexDirection: "column",
                        alignItems: infoFlipped ? "flex-end" : "flex-start",
                        width: "fit-content",
                        zIndex: 5,
                        pointerEvents: infoVisible ? "auto" : "none",
                        opacity: infoVisible ? 1 : 0,
                        transform: infoTransform,
                        transformOrigin: infoFlipped
                            ? "center right"
                            : "center left",
                        transition:
                            "opacity 0.25s cubic-bezier(0.65,0,0.35,1), transform 0.25s cubic-bezier(0.65,0,0.35,1)",
                    }}
                    onMouseEnter={handleMouseEnter}
                    onMouseLeave={() => onCellHoverEnd(id)}
                >
{img.title && (
    <InfoChip
        label={img.title}
        bg="transparent"
        textColor={infoBgColor}
        fontSize={infoFontSize}
        flipped={infoFlipped}
    />
)}
{img.creatorName && (
    <InfoChip
        label={img.creatorName}
        bg="transparent"
        textColor={infoBgColor}
        fontSize={infoFontSize}
        flipped={infoFlipped}
    />
)}
                    {(img.type || img.genre || img.releaseYear) && (
    <div style={{ display: "flex", flexDirection: "row" }}>
        <div
            style={{
                display: "flex",
                flexDirection: "row",
                gap: 16,
            }}
        >
            {img.type && (
                <InfoChip
                    label={img.type}
                    bg="transparent"
                    textColor={mutedInfoTextColor}
                    fontSize={infoFontSize}
                    flipped={infoFlipped}
                />
            )}
            {img.genre && (
                <InfoChip
                    label={img.genre}
                    bg="transparent"
                    textColor={mutedInfoTextColor}
                    fontSize={infoFontSize}
                    flipped={infoFlipped}
                />
            )}
            {img.releaseYear && (
                <InfoChip
                    label={String(img.releaseYear)}
                    bg="transparent"
                    textColor={mutedInfoTextColor}
                    fontSize={infoFontSize}
                    flipped={infoFlipped}
                />
            )}
        </div>
    </div>
)}
                </div>
            )}
        </motion.div>
    )
})

export const DESKTOP_DEFAULT_PROPS: Props = {
    logoGroup: { logo: undefined, logoDark: undefined },
    musicCD: {
        cellSize: 220,
        gap: 16,
        patternCols: 6,
        patternRows: 5,
        hoverScale: 1.04,
        borderRadius: 999,
        holeSize: 36,
        dragScale: 0.92,
        spineDepth: 28,
        textureImg: undefined,
        textureOpacity: 100,
        textureBlend: "screen",
    },
    booksGroup: {
        width: 770,
        spineWidth: 36,
        borderRadius: 4,
        spineDepth: 28,
        textureImg: undefined,
        textureOpacity: 100,
        textureBlend: "screen",
    },
    filmGroup: {
        width: 320,
        spineWidth: 10,
        borderRadius: 6,
        spineDepth: 28,
        textureImg: undefined,
        textureOpacity: 100,
        textureBlend: "screen",
    },
    filtersGroup: {
        blurIntensity: 24,
        contrast: 100,
        shadowIntensity: 0,
        noiseEnabled: false,
        noiseOpacity: 18,
        noiseSize: 180,
        noiseBlend: "overlay",
    },
    infoGroup: {
        showInfoOnHover: true,
        infoAccentColor: "#E298F2",
        infoTextColor: "#1C1C1C",
        infoFontSize: 16,
    },
    carouselGroup: {
        musicSpineGroup: {
            spineDepth: 28,
            spineTextEnabled: true,
            spineTextColor: "auto",
            spineFontSize: 11,
            spineFontWeight: 600,
            spineCreatorFontWeight: 400,
        },
        filmSpineGroup: {
            filmItemWidth: 320,
            filmItemHeight: 456,
            filmSpineDepth: 28,
            filmSpineTextEnabled: true,
            filmSpineTextColor: "auto",
            filmSpineFontSize: 11,
            filmSpineFontWeight: 600,
            filmSpineCreatorFontWeight: 400,
        },
        booksSpineGroup: {
            bookItemWidth: 280,
            bookEdgeGap: 12,
            bookSpineDepth: 28,
            bookSpineTextEnabled: true,
            bookSpineTextColor: "auto",
            bookSpineFontSize: 11,
            bookSpineFontWeight: 600,
            bookSpineCreatorFontWeight: 400,
        },
        rotationPerItem: 65,
        coverflowDepth: 80,
        perspective: 1200,
        tiltX: 0,
        autoRotate: false,
        autoRotateSpeed: 6,
        dragToRotate: true,
        dragSensitivity: 0.4,
        borderRadius: 14,
        shadow: true,
    } as any,
}

export default function InfiniteDragCanvas({
    logoGroup = DESKTOP_DEFAULT_PROPS.logoGroup,
    musicCD = DESKTOP_DEFAULT_PROPS.musicCD,
    booksGroup = DESKTOP_DEFAULT_PROPS.booksGroup,
    filmGroup = DESKTOP_DEFAULT_PROPS.filmGroup,
    filtersGroup = DESKTOP_DEFAULT_PROPS.filtersGroup,
    infoGroup = DESKTOP_DEFAULT_PROPS.infoGroup,
    carouselGroup = DESKTOP_DEFAULT_PROPS.carouselGroup,
}: Props) {
    const {
        logo,
        logoDark,
    } = logoGroup || {}
    const {
        cellSize,
        gap,
        patternCols,
        patternRows,
        hoverScale,
        borderRadius,
        holeSize,
        dragScale,
        spineDepth: musicFreeformSpineDepth,
        textureImg: musicTextureImg,
        textureOpacity: musicTextureOpacity,
        textureBlend: musicTextureBlend,
    } = musicCD || {}
    const {
        width: bookWidth,
        spineWidth,
        borderRadius: bookBorderRadius,
        spineDepth: bookFreeformSpineDepth,
        textureImg,
        textureOpacity,
        textureBlend: bookTextureBlend,
    } = booksGroup || {}
    const {
        width: filmWidth,
        spineWidth: filmSpineWidth,
        borderRadius: filmBorderRadius,
        spineDepth: filmFreeformSpineDepth,
        textureImg: filmTextureImg,
        textureOpacity: filmTextureOpacity,
        textureBlend: filmTextureBlend,
    } = filmGroup || {}
    const {
        blurIntensity,
        contrast,
        shadowIntensity,
        noiseEnabled,
        noiseOpacity,
        noiseSize,
        noiseBlend,
    } = filtersGroup || {}
    const { showInfoOnHover, infoTextColor, infoFontSize } = infoGroup || {}

    const [hoveredId, setHoveredId] = useState<string | null>(null)
    const [isDragging, setIsDragging] = useState(false)
    const [activeCategory, setActiveCategory] = useState(() => {
        if (typeof window === "undefined") return "Music"
        try {
            return localStorage.getItem("directory-active-category") || "Music"
        } catch (e) {
            return "Music"
        }
    })
    const [theme, setTheme] = useState<"light" | "dark">(() => {
        if (typeof window === "undefined") return "dark"
        try {
            const stored = localStorage.getItem("directory-theme")
            return stored === "light" || stored === "dark" ? stored : "dark"
        } catch (e) {
            return "dark"
        }
    })
    const containerRef = useRef<HTMLDivElement>(null)
    const [infoFlipped, setInfoFlipped] = useState(false)
    const cellRefs = useRef<Record<string, HTMLElement | null>>({})
    const hoverClearTimeoutRef = useRef<number | null>(null)
    const [viewCursorVisible, setViewCursorVisible] = useState(false)
    const viewCursorRef = useRef<HTMLDivElement>(null)
    const isOverActionButtonRef = useRef(false)
    const [editingEntry, setEditingEntry] = useState<Entry | null>(null)

    const cancelHoverClear = () => {
        if (hoverClearTimeoutRef.current) {
            clearTimeout(hoverClearTimeoutRef.current)
            hoverClearTimeoutRef.current = null
        }
    }

    const scheduleHoverClear = (id: string) => {
        cancelHoverClear()
        hoverClearTimeoutRef.current = window.setTimeout(() => {
            setHoveredId((prev) => (prev === id ? null : prev))
        }, 150)
    }

    const scatterRef = useRef<HTMLDivElement | null>(null)
    const [introVisible, setIntroVisible] = useState(true)
    const [showNewEntryModal, setShowNewEntryModal] = useState(false)
    const [showInfoModal, setShowInfoModal] = useState(false)
    const [showFilterModal, setShowFilterModal] = useState(false)
    const [filtersByCategory, setFiltersByCategory] = useState
        <Record<string, { type: string; genres: string[]; year: string }>
    >({})
    const [viewingEntry, setViewingEntry] = useState<Entry | null>(null)
    const [clickedKey, setClickedKey] = useState<string | null>(null)
    const [toastEntry, setToastEntry] = useState<ToastEntryData | null>(null)
    const [duplicateToastEntry, setDuplicateToastEntry] =
        useState<ToastEntryData | null>(null)

    const activeFilters = filtersByCategory[activeCategory] ?? DEFAULT_FILTERS
    const [viewMode, setViewMode] = useState<"freeform" | "carousel">(
        "freeform"
    )
    useEffect(() => {
        setViewingEntry(null)
        setViewCursorVisible(false)
    }, [activeCategory])

    useEffect(() => {
        const el = containerRef.current
        if (!el) return
        const handlePointerMove = (e: PointerEvent) => {
            const rect = el.getBoundingClientRect()
            const x = e.clientX - rect.left + 14
            const y = e.clientY - rect.top + 14
            if (viewCursorRef.current) {
                viewCursorRef.current.style.transform = `translate(${x}px, ${y}px)`
            }
        }
        el.addEventListener("pointermove", handlePointerMove)
        return () => el.removeEventListener("pointermove", handlePointerMove)
    }, [])

    useEffect(() => {
        if (isDragging) setViewCursorVisible(false)
    }, [isDragging])

    useEffect(() => {
        try {
            localStorage.setItem("directory-active-category", activeCategory)
        } catch (e) {}
    }, [activeCategory])

    useEffect(() => {
        try {
            localStorage.setItem("directory-theme", theme)
        } catch (e) {}
    }, [theme])

    // ─── Firestore data ──────────────────────────────────────────────────────
    const [entries, setEntries] = useState<Entry[]>([])
    const [loadingEntries, setLoadingEntries] = useState(true)
    const [spineColors, setSpineColors] = useState<Record<string, string>>({})

    const images = useMemo(() => entries.map(entryToImageItem), [entries])

    useEffect(() => {
        let cancelled = false
        images.forEach((img) => {
            if (!img.src || spineColors[img.src]) return
            getDominantColorForSpine(img.src).then((color) => {
                if (!cancelled)
                    setSpineColors((prev) => ({ ...prev, [img.src]: color }))
            })
        })
        return () => {
            cancelled = true
        }
    }, [images])

    useEffect(() => {
        const el = containerRef.current
        if (!el) return
        const handlePointerMove = (e: PointerEvent) => {
            const rect = el.getBoundingClientRect()
            const x = e.clientX - rect.left + 14
            const y = e.clientY - rect.top + 14
            if (viewCursorRef.current) {
                viewCursorRef.current.style.transform = `translate(${x}px, ${y}px)`
            }
        }
        el.addEventListener("pointermove", handlePointerMove)
        return () => el.removeEventListener("pointermove", handlePointerMove)
    }, [loadingEntries])
    const [searchValue, setSearchValue] = useState("")
    const canvasBackground = theme === "light" ? "#FEFEFE" : "#1C1C1C"

    useEffect(() => {
        if (typeof document === "undefined") return
        document.body.style.backgroundColor = canvasBackground
        document.documentElement.style.backgroundColor = canvasBackground
    }, [canvasBackground])
    const loadingTextColor =
        theme === "light"
            ? "rgba(28, 28, 28, 0.55)"
            : "rgba(254, 254, 254, 0.55)"
    const skeletonBase =
        theme === "light"
            ? "rgba(28, 28, 28, 0.08)"
            : "rgba(254, 254, 254, 0.1)"
    const skeletonMid =
        theme === "light"
            ? "rgba(28, 28, 28, 0.14)"
            : "rgba(254, 254, 254, 0.18)"
    const skeletonHighlight =
        theme === "light"
            ? "rgba(28, 28, 28, 0.2)"
            : "rgba(254, 254, 254, 0.26)"

    useEffect(() => {
        const oldCategory = CATEGORY_MAP[activeCategory]
        setLoadingEntries(true)
        let cancelled = false
        fetchEntriesByCategory(oldCategory)
            .then((data) => {
                if (cancelled) return
                const seen = new Set<string>()
                const unique = data.filter((e) => {
                    const key = e.title.toLowerCase().trim()
                    if (seen.has(key)) return false
                    seen.add(key)
                    return true
                })
                setEntries(unique)
                setLoadingEntries(false)
            })
            .catch((err) => {
                console.error("Failed to fetch entries:", err)
                if (!cancelled) setLoadingEntries(false)
            })
        return () => {
            cancelled = true
        }
    }, [activeCategory])

    const POLL_INTERVAL_MS = 8000

    useEffect(() => {
        const oldCategory = CATEGORY_MAP[activeCategory]
        let cancelled = false

        const interval = window.setInterval(async () => {
            try {
                const data = await fetchEntriesByCategory(oldCategory)
                if (cancelled) return
                setEntries((prev) => {
                    const existingIds = new Set(prev.map((e) => e.id))
                    const newOnes = data.filter((e) => !existingIds.has(e.id))
                    return newOnes.length > 0 ? [...newOnes, ...prev] : prev
                })
            } catch (err) {
                console.error("Poll failed:", err)
            }
        }, POLL_INTERVAL_MS)

        return () => {
            cancelled = true
            clearInterval(interval)
        }
    }, [activeCategory])

    const normalizedSearch = useMemo(
        () => normalizeSearchText(searchValue.trim()),
        [searchValue]
    )

    const normalizedSelectedTypes = useMemo(
        () =>
            activeFilters.type
                .split(",")
                .map((t) => normalizeSearchText(t.trim()))
                .filter(Boolean),
        [activeFilters.type]
    )
    const normalizedSelectedGenres = useMemo(
        () =>
            activeFilters.genres
                .map((genre) => normalizeSearchText(genre.trim()))
                .filter(Boolean),
        [activeFilters.genres]
    )
    const selectedYear = activeFilters.year.trim()

    const hasActiveFilters = useMemo(
        () =>
            normalizedSelectedTypes.length > 0 ||
            normalizedSelectedGenres.length > 0 ||
            selectedYear.length > 0,
        [normalizedSelectedTypes, normalizedSelectedGenres, selectedYear]
    )
    const matchedEntries = useMemo(() => {
        return entries.filter((entry) => {
            if (!entryMatchesSearch(entry, normalizedSearch)) return false

            if (normalizedSelectedTypes.length > 0) {
                const hasMatchingType = normalizedSelectedTypes.some((t) =>
                    textMatchesSearchLogic(
                        t,
                        entry.subcategory,
                        toTitleCaseLabel(entry.subcategory ?? "")
                    )
                )
                if (!hasMatchingType) return false
            }

            if (normalizedSelectedGenres.length > 0) {
                const entryGenres = (entry.genre ?? "")
                    .split(",")
                    .map((genre) => normalizeSearchText(genre.trim()))
                    .filter(Boolean)
                const hasMatchingGenre = normalizedSelectedGenres.some(
                    (selectedGenre) => entryGenres.includes(selectedGenre)
                )
                if (!hasMatchingGenre) return false
            }

            if (
                selectedYear &&
                !textMatchesSearchLogic(selectedYear, entry.release_year ?? "")
            ) {
                return false
            }

            return true
        })
    }, [
        entries,
        normalizedSearch,
        normalizedSelectedTypes,
        normalizedSelectedGenres,
        selectedYear,
    ])

    const matchedEntryIds = useMemo(
        () => matchedEntries.map((entry) => entry.id),
        [matchedEntries]
    )
    const matchedEntryIdSet = useMemo(
        () => new Set(matchedEntryIds),
        [matchedEntryIds]
    )
    const hasActiveSearch = normalizedSearch.length > 0
    const hasActiveRefinement = hasActiveSearch || hasActiveFilters

    const bookHeight = bookWidth * BOOK_ASPECT
    const filmHeight = filmWidth * FILM_CASE_ASPECT
    const tileW =
        activeCategory === "Books"
            ? Math.max(cellSize, bookWidth) + gap
            : activeCategory === "Film"
              ? Math.max(cellSize, filmWidth) + gap
              : cellSize + gap
    const tileH =
        activeCategory === "Books"
            ? Math.max(cellSize, bookHeight) + gap
            : activeCategory === "Film"
              ? Math.max(cellSize, filmHeight) + gap
              : cellSize + gap
    const patternW = tileW * patternCols
    const patternH = tileH * patternRows

    const effSpineDepth =
        activeCategory === "Film"
            ? (filmFreeformSpineDepth ?? 28)
            : activeCategory === "Books"
              ? (bookFreeformSpineDepth ?? 28)
              : (musicFreeformSpineDepth ?? 28)

    const effWidth =
        activeCategory === "Books"
            ? bookWidth
            : activeCategory === "Film"
              ? filmWidth
              : cellSize
    const effHeight =
        activeCategory === "Books"
            ? bookHeight
            : activeCategory === "Film"
              ? filmHeight
              : cellSize

    const [filmSpineColors, setFilmSpineColors] = useState
        <Record<string, string>
    >({})
    useEffect(() => {
        if (activeCategory !== "Film") return
        let cancelled = false
        const fraction = Math.min(0.3, Math.max(0.05, effSpineDepth / effWidth))
        images.forEach((img) => {
            if (!img.src) return
            const key = `${img.src}::${fraction.toFixed(3)}`
            if (filmSpineColors[key]) return
            getDominantColorForFilmSpine(img.src, fraction).then((color) => {
                if (!cancelled)
                    setFilmSpineColors((prev) => ({ ...prev, [key]: color }))
            })
        })
        return () => {
            cancelled = true
        }
    }, [images, activeCategory, effSpineDepth, effWidth])

    const innerDiscSize = cellSize * (holeSize / 100)
    const spindleSize = 10
    const spindleMask = `radial-gradient(circle at 50% 50%, transparent 0px, transparent ${spindleSize / 2}px, black ${spindleSize / 2 + 2}px, black 100%)`

    const x = useMotionValue(0)
    const y = useMotionValue(0)

    useEffect(() => {
        const wrap = (v: number, size: number) => {
            let m = v % size
            if (m > 0) m -= size
            return m
        }
        const unsubX = x.on("change", (v) => {
            const w = wrap(v, patternW)
            if (Math.abs(w - v) > 0.01) x.set(w)
        })
        const unsubY = y.on("change", (v) => {
            const w = wrap(v, patternH)
            if (Math.abs(w - v) > 0.01) y.set(w)
        })
        return () => {
            unsubX()
            unsubY()
        }
    }, [patternW, patternH])

    useEffect(() => {
        if (viewMode !== "freeform") return
        if (loadingEntries) return
        const el = scatterRef.current
        if (!el) return
        const handleWheel = (e: WheelEvent) => {
            e.preventDefault()
            x.set(x.get() - e.deltaX)
            y.set(y.get() - e.deltaY)
        }
        el.addEventListener("wheel", handleWheel, { passive: false })
        return () => el.removeEventListener("wheel", handleWheel)
    }, [viewMode, x, y, loadingEntries, images.length])

    const isDraggingRef = useRef(false)
    useEffect(() => {
        isDraggingRef.current = isDragging
    }, [isDragging])
    const entriesRef = useRef<Entry[]>([])
    useEffect(() => {
        entriesRef.current = entries
    }, [entries])
    const viewingEntryRef = useRef<Entry | null>(null)
    useEffect(() => {
        viewingEntryRef.current = viewingEntry
    }, [viewingEntry])

    const handleCellClick = useCallback((id: string, entryId: string) => {
        if (isDraggingRef.current) return
        const fullEntry = entriesRef.current.find((e) => e.id === entryId)
        if (fullEntry) {
            setClickedKey(id)
            setViewingEntry(fullEntry)
            setViewCursorVisible(true)
        }
    }, [])

    const handleEditEntry = useCallback((entry: Entry) => {
    setViewingEntry(null)
    setClickedKey(null)
    setViewCursorVisible(false)
    setEditingEntry(entry)
    setShowNewEntryModal(true)
}, [])

const handleDeleteEntry = useCallback(async (entry: Entry) => {
    const confirmed = window.confirm(
        `Delete "${entry.title}"? This can't be undone.`
    )
    if (!confirmed) return
    setViewingEntry(null)
    setClickedKey(null)
    setViewCursorVisible(false)
    setEntries((prev) => prev.filter((e) => e.id !== entry.id))
    removeMyEntryId(entry.id)
    try {
        await deleteEntry(entry.id)
    } catch (err) {
        console.error("Delete failed:", err)
    }
}, [])

    const handleUndoNewEntry = useCallback(async (entryId: string) => {
    setToastEntry(null)
    setEntries((prev) => prev.filter((e) => e.id !== entryId))
    removeMyEntryId(entryId)
    try {
        await deleteEntry(entryId)
    } catch (err) {
        console.error("Undo delete failed:", err)
    }
}, [])

    const handleCellHoverStart = useCallback((id: string) => {
        cancelHoverClear()
        setHoveredId(id)
        if (!isOverActionButtonRef.current) setViewCursorVisible(true)
    }, [])

    const handleCellHoverEnd = useCallback((id: string) => {
        scheduleHoverClear(id)
        if (viewingEntryRef.current) return
        if (!isOverActionButtonRef.current) setViewCursorVisible(false)
    }, [])

    const handleCellActionHover = useCallback((hovering: boolean) => {
        isOverActionButtonRef.current = hovering
        setViewCursorVisible(!hovering)
    }, [])

    const cells = useMemo(() => {
        const list: {
            col: number
            row: number
            img: ImageItem
            isMatched: boolean
        }[] = []
        if (!images.length) return list
        for (let r = -patternRows; r < patternRows * 2; r++) {
            for (let c = -patternCols; c < patternCols * 2; c++) {
                const pc = ((c % patternCols) + patternCols) % patternCols
                const pr = ((r % patternRows) + patternRows) % patternRows
                const idx = (pr * patternCols + pc) % images.length
                const image = images[idx]
                const isMatched =
                    !hasActiveRefinement || matchedEntryIdSet.has(image.entryId)
                list.push({ col: c, row: r, img: image, isMatched })
            }
        }
        return list
    }, [
        images,
        patternRows,
        patternCols,
        hasActiveRefinement,
        matchedEntryIdSet,
    ])

    const renderSkeletonShape = useCallback(
        (seed: number, width: number, height: number) => {
            const shimmerDelay = (seed % 17) * 0.04
            const pulseDelay = (seed % 13) * 0.05

            const shimmerLayer = (
                <motion.div
                    aria-hidden
                    animate={{ x: ["-120%", "120%"] }}
                    transition={{
                        duration: 1.8,
                        repeat: Infinity,
                        ease: "linear",
                        delay: shimmerDelay,
                    }}
                    style={{
                        position: "absolute",
                        top: 0,
                        bottom: 0,
                        width: "45%",
                        background: `linear-gradient(90deg, transparent, ${skeletonHighlight}, transparent)`,
                        pointerEvents: "none",
                    }}
                />
            )

            if (activeCategory === "Books") {
                return (
                    <motion.div
                        animate={{ opacity: [0.55, 0.95, 0.55] }}
                        transition={{
                            duration: 1.7,
                            repeat: Infinity,
                            ease: "easeInOut",
                            delay: pulseDelay,
                        }}
                        style={{
                            position: "relative",
                            width: bookWidth,
                            height: bookHeight,
                            borderRadius: bookBorderRadius,
                            background: `linear-gradient(135deg, ${skeletonBase} 0%, ${skeletonMid} 100%)`,
                            overflow: "hidden",
                            boxSizing: "border-box",
                        }}
                    >
                        <div
                            style={{
                                position: "absolute",
                                left: 0,
                                top: 0,
                                bottom: 0,
                                width: Math.max(4, spineWidth),
                                background: `linear-gradient(90deg, ${skeletonHighlight} 0%, ${skeletonMid} 58%, ${skeletonBase} 100%)`,
                            }}
                        />
                        {shimmerLayer}
                    </motion.div>
                )
            }

            if (activeCategory === "Film") {
                const size = Math.min(width, height)
                return (
                    <motion.div
                        animate={{ opacity: [0.55, 0.95, 0.55] }}
                        transition={{
                            duration: 1.7,
                            repeat: Infinity,
                            ease: "easeInOut",
                            delay: pulseDelay,
                        }}
                        style={{
                            position: "relative",
                            width: size,
                            height: size,
                            borderRadius: "50%",
                            background: `radial-gradient(circle at 50% 50%, ${skeletonMid} 0%, ${skeletonBase} 52%, ${skeletonMid} 100%)`,
                            overflow: "hidden",
                        }}
                    >
                        {shimmerLayer}
                    </motion.div>
                )
            }

            return (
                <motion.div
                    animate={{ opacity: [0.55, 0.95, 0.55] }}
                    transition={{
                        duration: 1.7,
                        repeat: Infinity,
                        ease: "easeInOut",
                        delay: pulseDelay,
                    }}
                    style={{
                        position: "relative",
                        width,
                        height,
                        borderRadius: "50%",
                        background: `radial-gradient(circle at 50% 45%, ${skeletonMid} 0%, ${skeletonBase} 72%)`,
                        overflow: "hidden",
                        maskImage: spindleMask,
                        WebkitMaskImage: spindleMask,
                    }}
                >
                    <div
                        style={{
                            position: "absolute",
                            left: "50%",
                            top: "50%",
                            width: innerDiscSize,
                            height: innerDiscSize,
                            transform: "translate(-50%, -50%)",
                            borderRadius: "50%",
                            background: skeletonHighlight,
                            opacity: 0.7,
                        }}
                    />
                    {shimmerLayer}
                </motion.div>
            )
        },
        [
            activeCategory,
            skeletonHighlight,
            skeletonMid,
            skeletonBase,
            spindleMask,
            innerDiscSize,
            bookWidth,
            bookHeight,
            bookBorderRadius,
            spineWidth,
        ]
    )

    if (loadingEntries) {
        const carouselItemWidth = carouselGroup?.musicSpineGroup?.itemWidth ?? 280
        const carouselItemHeight = carouselGroup?.musicSpineGroup?.itemHeight ?? 360
        const carouselEdgeGap = carouselGroup?.musicSpineGroup?.edgeGap ?? 12
        const carouselDepth = carouselGroup?.coverflowDepth ?? 80
        const carouselRotationPerItem = carouselGroup?.rotationPerItem ?? 65
        const skeletonRange = 4
        const carouselSlot = carouselItemWidth + carouselEdgeGap

        return (
            <div
                style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    gap: 16,
                    alignItems: "stretch",
                    justifyContent: "center",
                    padding: "80px 24px 40px",
                    boxSizing: "border-box",
                    overflow: "hidden",
                    position: "relative",
                    background: canvasBackground,
                }}
            >
                {viewMode === "freeform" ? (
                    <div
                        style={{
                            position: "absolute",
                            left: -patternW,
                            top: -patternH,
                            width: patternW * 3,
                            height: patternH * 3,
                        }}
                    >
                        {Array.from({ length: patternRows * 3 }).flatMap(
                            (_, rIndex) =>
                                Array.from({ length: patternCols * 3 }).map(
                                    (_, cIndex) => {
                                        const row = rIndex - patternRows
                                        const col = cIndex - patternCols
                                        const key = `sk-${col}-${row}`
                                        const isBook =
                                            activeCategory === "Books"
                                        const shapeSeed =
                                            Math.abs(
                                                col * 73856093 + row * 19349663
                                            ) % 97
                                        const bookOffsetX = isBook
                                            ? Math.max(
                                                  0,
                                                  (bookWidth - cellSize) / 2
                                              )
                                            : 0
                                        const bookOffsetY = isBook
                                            ? Math.max(
                                                  0,
                                                  (bookHeight - cellSize) / 2
                                              )
                                            : 0

                                        return (
                                            <div
                                                key={key}
                                                style={{
                                                    position: "absolute",
                                                    left:
                                                        (col + patternCols) *
                                                            tileW -
                                                        bookOffsetX,
                                                    top:
                                                        (row + patternRows) *
                                                            tileH -
                                                        bookOffsetY,
                                                    width: isBook
                                                        ? bookWidth
                                                        : cellSize,
                                                    height: isBook
                                                        ? bookHeight
                                                        : cellSize,
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                }}
                                            >
                                                {renderSkeletonShape(
                                                    shapeSeed,
                                                    cellSize,
                                                    cellSize
                                                )}
                                            </div>
                                        )
                                    }
                                )
                        )}
                    </div>
                ) : (
                    <div
                        style={{
                            position: "absolute",
                            inset: 0,
                            perspective: `${carouselGroup?.perspective ?? 1200}px`,
                        }}
                    >
                        <div
                            style={{
                                position: "absolute",
                                left: "50%",
                                top: "50%",
                                width: 0,
                                height: 0,
                                transformStyle: "preserve-3d",
                            }}
                        >
                            {Array.from({
                                length: skeletonRange * 2 + 1,
                            }).map((_, index) => {
                                const d = index - skeletonRange
                                const flipFactor = Math.tanh(d * 2.2)
                                const rotateY =
                                    -flipFactor * carouselRotationPerItem
                                const angleRad = (rotateY * Math.PI) / 180
                                const z =
                                    -Math.abs(Math.sin(angleRad)) *
                                    carouselDepth
                                const xPos = d * carouselSlot
                                const seed = Math.abs(d) * 10 + index
                                return (
                                    <div
                                        key={`carousel-skeleton-${index}`}
                                        style={{
                                            position: "absolute",
                                            left: 0,
                                            top: 0,
                                            width: carouselItemWidth,
                                            height: carouselItemHeight,
                                            transform: `translate(-50%, -50%) translateX(${xPos}px) translateZ(${z}px) rotateY(${rotateY}deg)`,
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                        }}
                                    >
                                        {renderSkeletonShape(
                                            seed,
                                            carouselItemWidth,
                                            carouselItemHeight
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                )}
                <div
                    style={{
                        position: "absolute",
                        left: "50%",
                        bottom: 16,
                        transform: "translateX(-50%)",
                        color: loadingTextColor,
                        fontFamily: "'Spline Sans Mono', monospace",
                        fontSize: 14,
                        letterSpacing: "0.01em",
                        textAlign: "center",
                    }}
                >
                    Loading entries...
                </div>
            </div>
        )
    }

    const hasNoResults = !entries || entries.length === 0

    const infoBgColor = theme === "dark" ? "#FEFEFE" : "#1C1C1C"
    const infoBgTextColor = theme === "dark" ? "#1C1C1C" : "#FEFEFE"

    return (
        <div
            ref={containerRef}
            style={{
                width: "100%",
                height: "100%",
                overflow: "hidden",
                position: "relative",
                background: canvasBackground,
                touchAction: "none",
            }}
        >
            <style>{`
 @import url('https://fonts.googleapis.com/css2?family=Spline+Sans:wght@300;400;500;600;700&family=Spline+Sans+Mono:wght@400;500;600&display=swap');
 .directory-search-input::placeholder {
 color: var(--placeholder-color, #FEFEFE);
 opacity: 1;
 }
 .modal-field-input::placeholder {
 color: var(--placeholder-color, #FEFEFE);
 opacity: 1;
 }
`}</style>
            <DirectoryHeader
                logoSrc={theme === "dark" ? logoDark || logo : logo}
                searchValue={searchValue}
                categories={["Music", "Film", "Books"]}
                activeCategory={activeCategory}
                onCategoryChange={setActiveCategory}
                theme={theme}
                onThemeChange={setTheme}
                onSearch={setSearchValue}
                onInfo={() => setShowInfoModal(true)}
                onNewEntry={() => {
    setEditingEntry(null)
    setShowNewEntryModal(true)
}}
            />

            {viewMode === "freeform" ? (
                <AnimatePresence mode="wait">
                    <motion.div
                        key="scattered"
                        ref={scatterRef}
                        drag
                        dragElastic={0}
                        dragMomentum={true}
                        dragTransition={{
                            power: 0.35,
                            timeConstant: 280,
                            restDelta: 0.5,
                        }}
                        onDragStart={() => setIsDragging(true)}
                        onDragEnd={() => setIsDragging(false)}
                        style={{
                            position: "absolute",
                            left: -patternW,
                            top: -patternH,
                            width: patternW * 3,
                            height: patternH * 3,
                            x,
                            y,
                            cursor: "grab",
                        }}
                        whileTap={{ cursor: "grabbing" }}
                    >
                        {cells.map(({ col, row, img, isMatched }, i) => {
                            const id = `${col}-${row}`
                            const isHovered = hoveredId === id
                            const seed = Math.abs(
                                Math.sin(col * 12.9898 + row * 78.233)
                            )
                            const delay = (seed % 1) * 0.35
                            const spineColor = img.src
                                ? spineColors[img.src] || "#0c0c0c"
                                : "#0c0c0c"
                            const filmFraction = Math.min(
                                0.3,
                                Math.max(0.05, effSpineDepth / effWidth)
                            )
                            const filmSpineColor = img.src
                                ? filmSpineColors[
                                      `${img.src}::${filmFraction.toFixed(3)}`
                                  ] || "#050505"
                                : "#050505"

                            return (
                                <GridCell
                                    key={`${col}-${row}-${i}`}
                                    id={id}
                                    col={col}
                                    row={row}
                                    tileW={tileW}
                                    tileH={tileH}
                                    leftPx={(col + patternCols) * tileW}
                                    topPx={(row + patternRows) * tileH}
                                    img={img}
                                    isMatched={isMatched}
                                    isHovered={isHovered}
                                    isDragging={isDragging}
                                    isClicked={id === clickedKey}
                                    entryOpen={!!viewingEntry}
                                    delay={delay}
                                    hoverScale={hoverScale}
                                    dragScale={dragScale}
                                    blurIntensity={blurIntensity}
                                    borderRadius={borderRadius}
                                    activeCategory={activeCategory}
                                    cellDisplayWidth={
                                        activeCategory === "Books"
                                            ? bookWidth
                                            : activeCategory === "Film"
                                              ? filmWidth
                                              : cellSize
                                    }
                                    cellDisplayHeight={
                                        activeCategory === "Books"
                                            ? bookHeight
                                            : activeCategory === "Film"
                                              ? filmHeight
                                              : cellSize
                                    }
                                    effWidth={effWidth}
                                    effHeight={effHeight}
                                    effSpineDepth={effSpineDepth}
                                    bookWidth={bookWidth}
                                    filmWidth={filmWidth}
                                    cellSize={cellSize}
                                    contrast={contrast}
                                    shadowIntensity={shadowIntensity}
                                    noiseEnabled={noiseEnabled}
                                    noiseSize={noiseSize}
                                    noiseOpacity={noiseOpacity}
                                    noiseBlend={noiseBlend}
                                    musicTextureImg={musicTextureImg}
                                    musicTextureOpacity={musicTextureOpacity}
                                    musicTextureBlend={musicTextureBlend}
                                    spineWidth={spineWidth}
                                    bookBorderRadius={bookBorderRadius}
                                    textureImg={textureImg}
                                    textureOpacity={textureOpacity}
                                    bookTextureBlend={bookTextureBlend}
                                    filmSpineWidth={filmSpineWidth}
                                    filmBorderRadius={filmBorderRadius}
                                    filmTextureImg={filmTextureImg}
                                    filmTextureOpacity={filmTextureOpacity}
                                    filmTextureBlend={filmTextureBlend}
                                    spineColor={spineColor}
                                    filmSpineColor={filmSpineColor}
                                    showInfoOnHover={showInfoOnHover}
                                    infoFontSize={infoFontSize}
                                    infoBgColor={infoBgColor}
                                    infoBgTextColor={infoBgTextColor}
                                    containerRef={containerRef}
                                    onCellClick={handleCellClick}
                                    onCellHoverStart={handleCellHoverStart}
                                    onCellHoverEnd={handleCellHoverEnd}
                                    onActionHover={handleCellActionHover}
                                />
                            )
                        })}
                    </motion.div>
                    <motion.div
                        aria-hidden
                        initial={false}
                        animate={{ opacity: hoveredId !== null ? 1 : 0 }}
                        transition={{ duration: 0.25 }}
                        style={{
                            position: "absolute",
                            inset: 0,
                            zIndex: 5,
                            pointerEvents: "none",
                            backdropFilter: `blur(${blurIntensity}px)`,
                            WebkitBackdropFilter: `blur(${blurIntensity}px)`,
                        }}
                    />
                </AnimatePresence>
            ) : (
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        zIndex: 1,
                    }}
                >
                    <Carousel3D
                        images={images}
                        activeSearch={hasActiveRefinement}
                        matchedEntryIds={matchedEntryIds}
                        {...(carouselGroup || {})}
                        itemWidth={carouselGroup?.musicSpineGroup?.itemWidth}
                        itemHeight={carouselGroup?.musicSpineGroup?.itemHeight}
                        edgeGap={carouselGroup?.musicSpineGroup?.edgeGap}
                        spineDepth={carouselGroup?.musicSpineGroup?.spineDepth}
                        spineTextEnabled={
                            carouselGroup?.musicSpineGroup?.spineTextEnabled
                        }
                        spineTextColor={
                            carouselGroup?.musicSpineGroup?.spineTextColor
                        }
                        spineFontSize={
                            carouselGroup?.musicSpineGroup?.spineFontSize
                        }
                        spineFontWeight={
                            carouselGroup?.musicSpineGroup?.spineFontWeight
                        }
                        spineCreatorFontWeight={
                            carouselGroup?.musicSpineGroup
                                ?.spineCreatorFontWeight
                        }
                        filmItemWidth={
                            carouselGroup?.filmSpineGroup?.filmItemWidth
                        }
                        filmEdgeGap={carouselGroup?.filmSpineGroup?.filmEdgeGap}
                        filmSpineDepth={
                            carouselGroup?.filmSpineGroup?.filmSpineDepth
                        }
                        filmSpineTextEnabled={
                            carouselGroup?.filmSpineGroup?.filmSpineTextEnabled
                        }
                        filmSpineTextColor={
                            carouselGroup?.filmSpineGroup?.filmSpineTextColor
                        }
                        filmSpineFontSize={
                            carouselGroup?.filmSpineGroup?.filmSpineFontSize
                        }
                        filmSpineFontWeight={
                            carouselGroup?.filmSpineGroup?.filmSpineFontWeight
                        }
                        filmSpineCreatorFontWeight={
                            carouselGroup?.filmSpineGroup
                                ?.filmSpineCreatorFontWeight
                        }
                        bookItemWidth={
                            carouselGroup?.booksSpineGroup?.bookItemWidth
                        }
                        bookEdgeGap={
                            carouselGroup?.booksSpineGroup?.bookEdgeGap
                        }
                        bookSpineDepth={
                            carouselGroup?.booksSpineGroup?.bookSpineDepth
                        }
                        bookSpineTextEnabled={
                            carouselGroup?.booksSpineGroup?.bookSpineTextEnabled
                        }
                        bookSpineTextColor={
                            carouselGroup?.booksSpineGroup?.bookSpineTextColor
                        }
                        bookSpineFontSize={
                            carouselGroup?.booksSpineGroup?.bookSpineFontSize
                        }
                        bookSpineFontWeight={
                            carouselGroup?.booksSpineGroup?.bookSpineFontWeight
                        }
                        bookSpineCreatorFontWeight={
                            carouselGroup?.booksSpineGroup
                                ?.bookSpineCreatorFontWeight
                        }
                        contrast={contrast}
                        filmWidth={filmWidth}
                        filmSpineWidth={filmSpineWidth}
                        filmBorderRadius={filmBorderRadius}
                        filmTextureImg={filmTextureImg}
                        filmTextureOpacity={filmTextureOpacity}
                        filmTextureBlend={filmTextureBlend}
                        musicTextureImg={musicTextureImg}
                        musicTextureOpacity={musicTextureOpacity}
                        musicTextureBlend={musicTextureBlend}
                        bookWidth={bookWidth}
                        spineWidth={spineWidth}
                        bookBorderRadius={bookBorderRadius}
                        textureImg={textureImg}
                        textureOpacity={textureOpacity}
                        textureBlend={bookTextureBlend}
                        shadowIntensity={shadowIntensity}
                        blurIntensity={blurIntensity}
                        noiseEnabled={noiseEnabled}
                        noiseOpacity={noiseOpacity}
                        noiseSize={noiseSize}
                        noiseBlend={noiseBlend}
                        holeSize={holeSize}
                        showInfoOnHover={showInfoOnHover}
                        infoTextColor={infoTextColor}
                        infoFontSize={infoFontSize}
                        infoBgColor={infoBgColor}
                        infoBgTextColor={infoBgTextColor}
                        activeCategory={activeCategory}
                        paused={!!viewingEntry}
                        onItemHoverChange={(hovering) => {
                            if (hovering || !viewingEntry)
                                setViewCursorVisible(hovering)
                        }}
                        onItemSelect={(entryId) => {
                            const fullEntry = entries.find(
                                (e) => e.id === entryId
                            )
                            if (fullEntry) {
                                setViewingEntry(fullEntry)
                                setViewCursorVisible(true)
                            }
                        }}
                    />
                </div>
            )}
            {hasNoResults && (
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "24px",
                        boxSizing: "border-box",
                        color: loadingTextColor,
                        fontFamily: "'Spline Sans Mono', monospace",
                        fontSize: 14,
                        textAlign: "center",
                        pointerEvents: "none",
                        zIndex: 2,
                    }}
                >
                    {"No entries yet for this category"}
                </div>
            )}
            <IntroBanner
                visible={introVisible}
                onDismiss={() => setIntroVisible(false)}
                theme={theme}
            />
            <BottomToolbar
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                onFilters={() => setShowFilterModal(true)}
                theme={theme}
                filterCount={
                    activeFilters.type
                        .split(",")
                        .filter((t) => t.trim().length > 0).length +
                    activeFilters.genres.length +
                    (activeFilters.year.trim() ? 1 : 0)
                }
                onClearFilters={() =>
                    setFiltersByCategory((prev) => ({
                        ...prev,
                        [activeCategory]: { type: "", genres: [], year: "" },
                    }))
                }
            />
            <NewEntryModal
    visible={showNewEntryModal}
    onClose={() => {
        setShowNewEntryModal(false)
        setEditingEntry(null)
    }}
    theme={theme}
    defaultCategory={activeCategory}
    entries={entries}
    editingEntry={editingEntry}
    onDuplicate={(existing) => {
        setDuplicateToastEntry({
            entryId: existing.id,
            title: existing.title,
            creatorName: existing.creator_name,
            coverImageUrl: existing.cover_image_url,
            type: toTitleCaseLabel(existing.subcategory),
            genre: existing.genre
                ? existing.genre.split(",")[0]
                : undefined,
            releaseYear: existing.release_year,
        })
    }}
    onSubmitted={(entry) => {
        if (editingEntry) {
            setEntries((prev) =>
                prev.map((e) => (e.id === entry.id ? entry : e))
            )
            setEditingEntry(null)
            return
        }
        if (entry.category === CATEGORY_MAP[activeCategory]) {
            setEntries((prev) => [entry, ...prev])
        }
        addMyEntryId(entry.id)
        setToastEntry({
            entryId: entry.id,
            title: entry.title,
            creatorName: entry.creator_name,
            coverImageUrl: entry.cover_image_url,
            type: toTitleCaseLabel(entry.subcategory),
            genre: entry.genre
                ? entry.genre.split(",")[0]
                : undefined,
            releaseYear: entry.release_year,
        })
    }}
/>
            <EntryAddedToast
    entry={toastEntry}
    onClose={() => setToastEntry(null)}
    onUndo={
        toastEntry
            ? () => handleUndoNewEntry(toastEntry.entryId)
            : undefined
    }
    theme={theme}
/>
<EntryAddedToast
    entry={duplicateToastEntry}
    onClose={() => setDuplicateToastEntry(null)}
    theme={theme}
    label="Already In Directory"
/>
            <FilterModal
                visible={showFilterModal}
                onClose={() => setShowFilterModal(false)}
                theme={theme}
                activeCategory={activeCategory}
                entries={entries}
                initialType={activeFilters.type}
                initialGenres={activeFilters.genres}
                initialYear={activeFilters.year}
                onApply={(filters) =>
                    setFiltersByCategory((prev) => ({
                        ...prev,
                        [activeCategory]: filters,
                    }))
                }
            />
            <InfoModal
                visible={showInfoModal}
                onClose={() => setShowInfoModal(false)}
                theme={theme}
            />
            <EntryDetailModal
    visible={!!viewingEntry}
    onClose={() => {
        setViewingEntry(null)
        setClickedKey(null)
        setViewCursorVisible(false)
    }}
    theme={theme}
    entry={viewingEntry}
    activeCategory={activeCategory}
    contrast={contrast}
    holeSize={holeSize}
    bookWidth={bookWidth}
    spineWidth={spineWidth}
    bookBorderRadius={bookBorderRadius}
    textureImg={textureImg}
    textureOpacity={textureOpacity}
    onCursorHoverChange={setViewCursorVisible}
    onEdit={handleEditEntry}
    onDelete={handleDeleteEntry}
/>
            <div
                ref={viewCursorRef}
                style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    zIndex: 9999,
                    pointerEvents: "none",
                    opacity: viewCursorVisible ? 1 : 0,
                    transition: "opacity 0.15s ease",
                    willChange: "transform",
                }}
            >
                {viewingEntry ? <CloseCursor /> : <ViewCursor />}
            </div>
        </div>
    )
}