import { useEffect, useState, useRef, useCallback, useMemo, memo } from "react"
import {
    motion,
    AnimatePresence,
    useMotionValue,
    useDragControls,
} from "framer-motion"

import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"

const FIRESTORE_PROJECT_ID = "thee-monolith"
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents`

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
    if (!res.ok)
        throw new Error(
            `Firestore query failed: ${res.status} ${await res.text()}`
        )
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
    if (!res.ok)
        throw new Error(
            `Firestore add failed: ${res.status} ${await res.text()}`
        )
    const doc = await res.json()
    return firestoreDocToEntry(doc)
}

async function deleteEntry(entryId: string): Promise<void> {
    const res = await fetch(
        `${FIRESTORE_BASE}/entries/${entryId}?key=${firebaseConfig.apiKey}`,
        { method: "DELETE" }
    )
    if (!res.ok)
        throw new Error(
            `Firestore delete failed: ${res.status} ${await res.text()}`
        )
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
    if (!res.ok)
        throw new Error(
            `Firestore update failed: ${res.status} ${await res.text()}`
        )
    const doc = await res.json()
    return firestoreDocToEntry(doc)
}

const firebaseConfig = {
    apiKey: "AIzaSyB3comQKuAEtrCp5NlaCyzrCM06kIVynII",
    authDomain: "thee-monolith.firebaseapp.com",
    projectId: "thee-monolith",
    storageBucket: "thee-monolith.firebasestorage.app",
    messagingSenderId: "822214230428",
    appId: "1:822214230428:web:b6f9d075d3519a0600c859",
    measurementId: "G-SH4T1ZX3MM",
}

const UPLOAD_WORKER_URL =
    "https://thee-monolith-upload.hamdiyaalhassan66.workers.dev"
const R2_MODELS_PUBLIC_URL =
    "https://pub-47f1e1d8fb014b909d74df6e1e78811d.r2.dev"

    const REVERSE_CATEGORY_MAP: Record<string, string> = {
    sound: "Music",
    screen: "Film",
    print: "Books",
}

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

const CATEGORY_MAP: Record<string, "screen" | "sound" | "print"> = {
    Music: "sound",
    Film: "screen",
    Books: "print",
}
const DEFAULT_FILTERS = { type: "", genres: [] as string[], year: "" }

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

// ─── Shared helpers (identical to desktop) ─────────────────────────────────
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
    const fields = [
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
    return fields.some((field) => {
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
    if (itunesPreviewCache.has(cacheKey))
        return itunesPreviewCache.get(cacheKey) ?? null
    try {
        const term = encodeURIComponent(`${artist} ${title}`.trim())
        const res = await fetch(
            `https://itunes.apple.com/search?term=${term}&entity=song&limit=5`
        )
        const data = await res.json()
        const previewUrl: string | null =
            data?.results?.find((r: any) => r.previewUrl)?.previewUrl ?? null
        if (previewUrl) itunesPreviewCache.set(cacheKey, previewUrl)
        return previewUrl
    } catch (e) {
        console.log("itunes fetch failed", e)
        return null
    }
}

const CONVERGE_X = -160
const CONVERGE_Y = 220
const CLICK_THRESHOLD = 8

function makeNoiseSvg(size: number): string {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/></filter><rect width='${size}' height='${size}' filter='url(#n)'/></svg>`
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}
function makeFabricNoiseSvg(size: number): string {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'><filter id='f'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='matrix' values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.5 0'/></filter><rect width='${size}' height='${size}' filter='url(#f)'/></svg>`
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

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

const FONT = "'Spline Sans Mono', monospace"
const PINK = "#E298F2"
const DARK = "#1C1C1C"
const WHITE = "#FEFEFE"
const CLOSE_PATH =
    "M13.0306 11.9695C13.1715 12.1104 13.2506 12.3015 13.2506 12.5007C13.2506 12.7 13.1715 12.8911 13.0306 13.032C12.8897 13.1729 12.6986 13.252 12.4993 13.252C12.3001 13.252 12.109 13.1729 11.9681 13.032L7.99997 9.06261L4.0306 13.0307C3.8897 13.1716 3.69861 13.2508 3.49935 13.2508C3.30009 13.2508 3.10899 13.1716 2.9681 13.0307C2.8272 12.8898 2.74805 12.6987 2.74805 12.4995C2.74805 12.3002 2.8272 12.1091 2.9681 11.9682L6.93747 8.00011L2.96935 4.03073C2.82845 3.88984 2.7493 3.69874 2.7493 3.49948C2.7493 3.30023 2.82845 3.10913 2.96935 2.96823C3.11024 2.82734 3.30134 2.74818 3.5006 2.74818C3.69986 2.74818 3.89095 2.82734 4.03185 2.96823L7.99997 6.93761L11.9693 2.96761C12.1102 2.82671 12.3013 2.74756 12.5006 2.74756C12.6999 2.74756 12.891 2.82671 13.0318 2.96761C13.1727 3.10851 13.2519 3.2996 13.2519 3.49886C13.2519 3.69812 13.1727 3.88921 13.0318 4.03011L9.06247 8.00011L13.0306 11.9695Z"

// ─── Icons ──────────────────────────────────────────────────────────────────
const Icon = {
    Close: ({ color = DARK, size = 16 }: { color?: string; size?: number }) => (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
            <path d={CLOSE_PATH} fill={color} />
        </svg>
    ),
    Search: ({ color = PINK }: { color?: string }) => (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
                d="M14.5305 13.4693L11.5624 10.4999C12.4524 9.34021 12.8678 7.88541 12.7246 6.43063C12.5814 4.97585 11.8901 3.63002 10.7911 2.66616C9.69203 1.7023 8.26751 1.19257 6.80648 1.24039C5.34544 1.2882 3.9573 1.88998 2.92364 2.92364C1.88998 3.9573 1.2882 5.34544 1.24039 6.80648C1.19257 8.26751 1.7023 9.69203 2.66616 10.7911C3.63002 11.8901 4.97585 12.5814 6.43063 12.7246C7.88541 12.8678 9.34021 12.4524 10.4999 11.5624L13.4705 14.5337C13.5403 14.6034 13.6231 14.6588 13.7143 14.6965C13.8054 14.7343 13.9031 14.7537 14.0018 14.7537C14.1005 14.7537 14.1981 14.7343 14.2893 14.6965C14.3805 14.6588 14.4633 14.6034 14.533 14.5337C14.6028 14.4639 14.6581 14.3811 14.6959 14.2899C14.7337 14.1988 14.7531 14.1011 14.7531 14.0024C14.7531 13.9038 14.7337 13.8061 14.6959 13.7149C14.6581 13.6238 14.6028 13.5409 14.533 13.4712L14.5305 13.4693ZM2.74991 6.99991C2.74991 6.15934 2.99917 5.33765 3.46617 4.63874C3.93316 3.93983 4.59692 3.3951 5.37351 3.07343C6.1501 2.75175 7.00463 2.66759 7.82905 2.83158C8.65347 2.99556 9.41075 3.40034 10.0051 3.99471C10.5995 4.58908 11.0043 5.34636 11.1683 6.17078C11.3322 6.9952 11.2481 7.84973 10.9264 8.62632C10.6047 9.40291 10.06 10.0667 9.36109 10.5337C8.66218 11.0007 7.84049 11.2499 6.99991 11.2499C5.8731 11.2488 4.79277 10.8006 3.99599 10.0038C3.19921 9.20706 2.75107 8.12673 2.74991 6.99991Z"
                fill={color}
            />
        </svg>
    ),
    Caret: ({
        color = DARK,
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
            style={{ transform: `rotate(${rotate}deg)`, flexShrink: 0 }}
        >
            <path
                d="M2.64635 6.35375L7.64634 11.3537C7.69278 11.4002 7.74793 11.4371 7.80862 11.4623C7.86932 11.4874 7.93439 11.5004 8.00009 11.5004C8.0658 11.5004 8.13087 11.4874 8.19157 11.4623C8.25226 11.4371 8.30741 11.4002 8.35385 11.3537L13.3538 6.35375C13.4239 6.28382 13.4715 6.1947 13.4909 6.09765C13.5102 6.00061 13.5003 5.90002 13.4624 5.8086C13.4245 5.71719 13.3604 5.63908 13.2781 5.58414C13.1958 5.5292 13.099 5.49992 13.0001 5.5H3.0001C2.90115 5.49992 2.8044 5.5292 2.7221 5.58414C2.63981 5.63908 2.57566 5.71719 2.53778 5.8086C2.49991 5.90002 2.49001 6.00061 2.50933 6.09765C2.52866 6.1947 2.57634 6.28382 2.64635 6.35375Z"
                fill={color}
            />
        </svg>
    ),
    Funnel: ({ color = PINK }: { color?: string }) => (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
                d="M12.75 8.5C12.75 8.69891 12.671 8.88968 12.5303 9.03033C12.3897 9.17098 12.1989 9.25 12 9.25H4C3.80109 9.25 3.61032 9.17098 3.46967 9.03033C3.32902 8.88968 3.25 8.69891 3.25 8.5C3.25 8.30109 3.32902 8.11032 3.46967 7.96967C3.61032 7.82902 3.80109 7.75 4 7.75H12C12.1989 7.75 12.3897 7.82902 12.5303 7.96967C12.671 8.11032 12.75 8.30109 12.75 8.5ZM14.5 4.75H1.5C1.30109 4.75 1.11032 4.82902 0.96967 4.96967C0.829018 5.11032 0.75 5.30109 0.75 5.5C0.75 5.69891 0.829018 5.88968 0.96967 6.03033C1.11032 6.17098 1.30109 6.25 1.5 6.25H14.5C14.6989 6.25 14.8897 6.17098 15.0303 6.03033C15.171 5.88968 15.25 5.69891 15.25 5.5C15.25 5.30109 15.171 5.11032 15.0303 4.96967C14.8897 4.82902 14.6989 4.75 14.5 4.75ZM9.5 10.75H6.5C6.30109 10.75 6.11032 10.829 5.96967 10.9697C5.82902 11.1103 5.75 11.3011 5.75 11.5C5.75 11.6989 5.82902 11.8897 5.96967 12.0303C6.11032 12.171 6.30109 12.25 6.5 12.25H9.5C9.69891 12.25 9.88968 12.171 10.0303 12.0303C10.171 11.8897 10.25 11.6989 10.25 11.5C10.25 11.3011 10.171 11.1103 10.0303 10.9697C9.88968 10.829 9.69891 10.75 9.5 10.75Z"
                fill={color}
            />
        </svg>
    ),
    Plus: ({ color = DARK }: { color?: string }) => (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
                d="M14.25 8C14.25 8.19891 14.171 8.38968 14.0303 8.53033C13.8897 8.67098 13.6989 8.75 13.5 8.75H8.75V13.5C8.75 13.6989 8.67098 13.8897 8.53033 14.0303C8.38968 14.171 8.19891 14.25 8 14.25C7.80109 14.25 7.61032 14.171 7.46967 14.0303C7.32902 13.8897 7.25 13.6989 7.25 13.5V8.75H2.5C2.30109 8.75 2.11032 8.67098 1.96967 8.53033C1.82902 8.38968 1.75 8.19891 1.75 8C1.75 7.80109 1.82902 7.61032 1.96967 7.46967C2.11032 7.32902 2.30109 7.25 2.5 7.25H7.25V2.5C7.25 2.30109 7.32902 2.11032 7.46967 1.96967C7.61032 1.82902 7.80109 1.75 8 1.75C8.19891 1.75 8.38968 1.82902 8.53033 1.96967C8.67098 2.11032 8.75 2.30109 8.75 2.5V7.25H13.5C13.6989 7.25 13.8897 7.32902 14.0303 7.46967C14.171 7.61032 14.25 7.80109 14.25 8Z"
                fill={color}
            />
        </svg>
    ),
    Sun: ({ color = PINK }: { color?: string }) => (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
                d="M7.5 2.5V1C7.5 0.867392 7.55268 0.740215 7.64645 0.646447C7.74021 0.552678 7.86739 0.5 8 0.5C8.13261 0.5 8.25979 0.552678 8.35355 0.646447C8.44732 0.740215 8.5 0.867392 8.5 1V2.5C8.5 2.63261 8.44732 2.75979 8.35355 2.85355C8.25979 2.94732 8.13261 3 8 3C7.86739 3 7.74021 2.94732 7.64645 2.85355C7.55268 2.75979 7.5 2.63261 7.5 2.5ZM8 4C7.20887 4 6.43552 4.2346 5.77772 4.67412C5.11992 5.11365 4.60723 5.73836 4.30448 6.46927C4.00173 7.20017 3.92252 8.00444 4.07686 8.78036C4.2312 9.55629 4.61216 10.269 5.17157 10.8284C5.73098 11.3878 6.44371 11.7688 7.21964 11.9231C7.99556 12.0775 8.79983 11.9983 9.53073 11.6955C10.2616 11.3928 10.8864 10.8801 11.3259 10.2223C11.7654 9.56448 12 8.79113 12 8C11.9988 6.93949 11.577 5.92275 10.8271 5.17285C10.0773 4.42296 9.06051 4.00116 8 4ZM3.64625 4.35375C3.74007 4.44757 3.86732 4.50028 4 4.50028C4.13268 4.50028 4.25993 4.44757 4.35375 4.35375C4.44757 4.25993 4.50028 4.13268 4.50028 4C4.50028 3.86732 4.44757 3.74007 4.35375 3.64625L3.35375 2.64625C3.25993 2.55243 3.13268 2.49972 3 2.49972C2.86732 2.49972 2.74007 2.55243 2.64625 2.64625C2.55243 2.74007 2.49972 2.86732 2.49972 3C2.49972 3.13268 2.55243 3.25993 2.64625 3.35375L3.64625 4.35375ZM3.64625 11.6462L2.64625 12.6462C2.55243 12.7401 2.49972 12.8673 2.49972 13C2.49972 13.1327 2.55243 13.2599 2.64625 13.3538C2.74007 13.4476 2.86732 13.5003 3 13.5003C3.13268 13.5003 3.25993 13.4476 3.35375 13.3538L4.35375 12.3538C4.40021 12.3073 4.43706 12.2521 4.4622 12.1914C4.48734 12.1308 4.50028 12.0657 4.50028 12C4.50028 11.9343 4.48734 11.8692 4.4622 11.8086C4.43706 11.7479 4.40021 11.6927 4.35375 11.6462C4.3073 11.5998 4.25214 11.5629 4.19145 11.5378C4.13075 11.5127 4.0657 11.4997 4 11.4997C3.9343 11.4997 3.86925 11.5127 3.80855 11.5378C3.74786 11.5629 3.69271 11.5998 3.64625 11.6462ZM12 4.5C12.0657 4.50005 12.1307 4.48716 12.1914 4.46207C12.2521 4.43697 12.3073 4.40017 12.3538 4.35375L13.3538 3.35375C13.4476 3.25993 13.5003 3.13268 13.5003 3C13.5003 2.86732 13.4476 2.74007 13.3538 2.64625C13.2599 2.55243 13.1327 2.49972 13 2.49972C12.8673 2.49972 12.7401 2.55243 12.6462 2.64625L11.6462 3.64625C11.5762 3.71618 11.5286 3.8053 11.5092 3.90235C11.4899 3.99939 11.4998 4.09998 11.5377 4.1914C11.5756 4.28281 11.6397 4.36092 11.722 4.41586C11.8043 4.4708 11.9011 4.50008 12 4.5ZM12.3538 11.6462C12.2599 11.5524 12.1327 11.4997 12 11.4997C11.8673 11.4997 11.7401 11.5524 11.6462 11.6462C11.5524 11.7401 11.4997 11.8673 11.4997 12C11.4997 12.1327 11.5524 12.2599 11.6462 12.3538L12.6462 13.3538C12.6927 13.4002 12.7479 13.4371 12.8086 13.4622C12.8692 13.4873 12.9343 13.5003 13 13.5003C13.0657 13.5003 13.1308 13.4873 13.1914 13.4622C13.2521 13.4371 13.3073 13.4002 13.3538 13.3538C13.4002 13.3073 13.4371 13.2521 13.4622 13.1914C13.4873 13.1308 13.5003 13.0657 13.5003 13C13.5003 12.9343 13.4873 12.8692 13.4622 12.8086C13.4371 12.7479 13.4002 12.6927 13.3538 12.6462L12.3538 11.6462ZM3 8C3 7.86739 2.94732 7.74021 2.85355 7.64645C2.75979 7.55268 2.63261 7.5 2.5 7.5H1C0.867392 7.5 0.740215 7.55268 0.646447 7.64645C0.552678 7.74021 0.5 7.86739 0.5 8C0.5 8.13261 0.552678 8.25979 0.646447 8.35355C0.740215 8.44732 0.867392 8.5 1 8.5H2.5C2.63261 8.5 2.75979 8.44732 2.85355 8.35355C2.94732 8.25979 3 8.13261 3 8ZM8 13C7.86739 13 7.74021 13.0527 7.64645 13.1464C7.55268 13.2402 7.5 13.3674 7.5 13.5V15C7.5 15.1326 7.55268 15.2598 7.64645 15.3536C7.74021 15.4473 7.86739 15.5 8 15.5C8.13261 15.5 8.25979 15.4473 8.35355 15.3536C8.44732 15.2598 8.5 15.1326 8.5 15V13.5C8.5 13.3674 8.44732 13.2402 8.35355 13.1464C8.25979 13.0527 8.13261 13 8 13ZM15 7.5H13.5C13.3674 7.5 13.2402 7.55268 13.1464 7.64645C13.0527 7.74021 13 7.86739 13 8C13 8.13261 13.0527 8.25979 13.1464 8.35355C13.2402 8.44732 13.3674 8.5 13.5 8.5H15C15.1326 8.5 15.2598 8.44732 15.3536 8.35355C15.4473 8.25979 15.5 8.13261 15.5 8C15.5 7.86739 15.4473 7.74021 15.3536 7.64645C15.2598 7.55268 15.1326 7.5 15 7.5Z"
                fill={color}
            />
        </svg>
    ),
    Moon: ({ color = DARK }: { color?: string }) => (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
                d="M14.7213 9.38808C14.3175 10.7062 13.5083 11.8634 12.4088 12.695C11.4434 13.4215 10.2947 13.8646 9.09155 13.9746C7.88837 14.0845 6.67836 13.8569 5.59733 13.3174C4.51631 12.7779 3.60705 11.9477 2.97162 10.9201C2.33619 9.89251 1.99974 8.70814 2.00003 7.49995C1.99569 6.08974 2.45413 4.71704 3.30503 3.59245C4.13662 2.49295 5.2938 1.68373 6.61191 1.27995C6.69878 1.2532 6.7913 1.25064 6.87952 1.27254C6.96774 1.29445 7.04832 1.33998 7.1126 1.40426C7.17688 1.46853 7.22241 1.54912 7.24432 1.63734C7.26622 1.72556 7.26366 1.81808 7.23691 1.90495C6.94868 2.85835 6.92452 3.87207 7.16698 4.83812C7.40945 5.80416 7.90947 6.68633 8.61375 7.39061C9.31803 8.09489 10.2002 8.59491 11.1662 8.83738C12.1323 9.07984 13.146 9.05568 14.0994 8.76745C14.1863 8.7407 14.2788 8.73814 14.367 8.76004C14.4552 8.78195 14.5358 8.82748 14.6001 8.89176C14.6644 8.95603 14.7099 9.03662 14.7318 9.12484C14.7537 9.21306 14.7512 9.30558 14.7244 9.39245L14.7213 9.38808Z"
                fill={color}
            />
        </svg>
    ),
    Info: ({ color = DARK }: { color?: string }) => (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
                d="M8 1.5C4.41015 1.5 1.5 4.41015 1.5 8C1.5 11.5899 4.41015 14.5 8 14.5C11.5899 14.5 14.5 11.5899 14.5 8C14.5 4.41015 11.5899 1.5 8 1.5ZM8.75 11.25C8.75 11.6642 8.41421 12 8 12C7.58579 12 7.25 11.6642 7.25 11.25V7.25C7.25 6.83579 7.58579 6.5 8 6.5C8.41421 6.5 8.75 6.83579 8.75 7.25V11.25ZM8 5.5C7.51675 5.5 7.125 5.10825 7.125 4.625C7.125 4.14175 7.51675 3.75 8 3.75C8.48325 3.75 8.875 4.14175 8.875 4.625C8.875 5.10825 8.48325 5.5 8 5.5Z"
                fill={color}
            />
        </svg>
    ),
}

// ─── LoadingDots / InfoChip / ListenButton (identical to desktop) ──────────
const LOADING_DOT_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315]
function LoadingDots({
    size = 16,
    color = DARK,
}: {
    size?: number
    color?: string
}) {
    return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
            {LOADING_DOT_ANGLES.map((angle, i) => {
                const rad = (angle * Math.PI) / 180
                const dx = Math.cos(rad) * 14
                const dy = -Math.sin(rad) * 14
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

function InfoChip({
    label,
    bg,
    textColor,
    fontSize,
}: {
    label: string
    bg: string
    textColor: string
    fontSize: number
}) {
    return (
        <div
            style={{
                display: "inline-flex",
                alignItems: "center",
                padding: `${fontSize * 0.25}px 6px`,
                background: bg,
                fontFamily: FONT,
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
}: {
    href?: string
    label?: string
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
            style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-start",
                padding: "12px 16px 24px 0",
                gap: 8,
                width: "100%",
                background: PINK,
                boxSizing: "border-box",
                textDecoration: "none",
                cursor: "pointer",
            }}
        >
            <span
                style={{
                    fontFamily: FONT,
                    fontWeight: 500,
                    fontSize: 14,
                    lineHeight: "20px",
                    color: DARK,
                }}
            >
                {label}
            </span>
        </a>
    )
}

// ─── VinylSleeve (flat sleeve — same texture/noise/shadow layering as desktop) ──
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

// ─── BookCover (identical to desktop) ──────────────────────────────────────
const BOOK_DESIGN_WIDTH = 770
const BOOK_DESIGN_HEIGHT = 1160
const BOOK_ASPECT = BOOK_DESIGN_HEIGHT / BOOK_DESIGN_WIDTH

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
                        "linear-gradient(90deg, rgba(255,255,255,0.16) 6.31%, rgba(0,0,0,0.4) 57.72%, rgba(255,255,255,0.2) 101.84%)",
                    borderRadius: mirrored
                        ? `0 ${radius}px ${radius}px 0`
                        : `${radius}px 0 0 ${radius}px`,
                }}
            />
            {/* head/tail curve — rounded bulge where the cloth wraps over the
                board's corner, matching desktop */}
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
                    borderRadius: `${radius}px ${spineWidth * s * 0.5}px 0 0`,
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
            {/* hinge / French groove */}
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
            {/* shading toward the spine */}
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

// ─── Three.js detail viewers (identical logic to desktop) ─────────────────
const BOOK_MESH_URL = `${R2_MODELS_PUBLIC_URL}/book-mockup.glb`
const VINYL_MESH_URL = `${R2_MODELS_PUBLIC_URL}/vinyl-sleeve.glb`
const DVD_MESH_URL = `${R2_MODELS_PUBLIC_URL}/dvd-case.glb`

const vinylGltfCache: {
    scene: THREE.Group | null
    promise: Promise<{ scene: THREE.Group }> | null
} = { scene: null, promise: null }
function loadVinylGltf(): Promise<{ scene: THREE.Group }> {
    if (vinylGltfCache.scene)
        return Promise.resolve({ scene: vinylGltfCache.scene.clone(true) })
    if (!vinylGltfCache.promise) {
        vinylGltfCache.promise = new Promise((resolve, reject) => {
            new GLTFLoader().load(
                VINYL_MESH_URL,
                (gltf) => {
                    vinylGltfCache.scene = gltf.scene
                    resolve({ scene: gltf.scene.clone(true) })
                },
                undefined,
                reject
            )
        })
    }
    return vinylGltfCache.promise
}
const dvdGltfCache: {
    scene: THREE.Group | null
    promise: Promise<{ scene: THREE.Group }> | null
} = { scene: null, promise: null }
function loadDvdGltf(): Promise<{ scene: THREE.Group }> {
    if (dvdGltfCache.scene)
        return Promise.resolve({ scene: dvdGltfCache.scene.clone(true) })
    if (!dvdGltfCache.promise) {
        dvdGltfCache.promise = new Promise((resolve, reject) => {
            new GLTFLoader().load(
                DVD_MESH_URL,
                (gltf) => {
                    dvdGltfCache.scene = gltf.scene
                    resolve({ scene: gltf.scene.clone(true) })
                },
                undefined,
                reject
            )
        })
    }
    return dvdGltfCache.promise
}
if (typeof window !== "undefined") {
    loadVinylGltf().catch(() => {})
    loadDvdGltf().catch(() => {})
}

function getBookDominantColor(image: HTMLImageElement): any {
    const canvas = document.createElement("canvas")
    const size = 32
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext("2d")!
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

function Book3DViewer({
    coverImageUrl,
    width,
    height,
    onReady,
}: {
    coverImageUrl: string
    width: number
    height: number
    onReady?: () => void
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
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        renderer.outputColorSpace = THREE.SRGBColorSpace
        renderer.toneMapping = THREE.ACESFilmicToneMapping
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
                dominantColor = new THREE.Color(0x333333)
            }
            new GLTFLoader().load(
                BOOK_MESH_URL,
                (gltf) => {
                    if (disposed) return
                    const model = gltf.scene
                    model.traverse((obj: any) => {
                        if (obj.isMesh) {
                            const isArray = Array.isArray(obj.material)
                            const mats = isArray ? obj.material : [obj.material]
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
                            obj.material = isArray ? newMats : newMats[0]
                        }
                    })
                    const box = new THREE.Box3().setFromObject(model)
                    const center = box.getCenter(new THREE.Vector3())
                    model.position.sub(center)
                    standGroup.add(model)
                    onReady?.()
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
                },
                undefined,
                (err) => console.error("GLTF load error", err)
            )
        })
        const maxTilt = THREE.MathUtils.degToRad(18)
        let targetTiltX = 0,
            targetTiltY = 0
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
            if (renderer.domElement.parentNode === mount)
                mount.removeChild(renderer.domElement)
        }
    }, [coverImageUrl, width, height])
    return (
        <div
            ref={mountRef}
            style={{ width, height, position: "relative", touchAction: "none" }}
        />
    )
}

function Vinyl3DViewer({
    coverImageUrl,
    width,
    height,
    spinning = false,
    onReady,
}: {
    coverImageUrl: string
    width: number
    height: number
    spinning?: boolean
    onReady?: () => void
}) {
    const mountRef = useRef<HTMLDivElement>(null)
    const spinningRef = useRef(spinning)
    useEffect(() => {
        spinningRef.current = spinning
    }, [spinning])
    useEffect(() => {
        if (!coverImageUrl) return
        const mount = mountRef.current
        if (!mount) return
        const renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
        })
        renderer.setSize(width, height)
        renderer.setPixelRatio(Math.min(window.devicePixelRatio * 2, 3))
        renderer.outputColorSpace = THREE.SRGBColorSpace
        renderer.toneMapping = THREE.ACESFilmicToneMapping
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
                        } else if (name === "spiral001") {
                            mats.forEach((m: any) => {
                                m.color.copy(dominantColor).multiplyScalar(3)
                                m.needsUpdate = true
                            })
                            vinylObjs.push(obj)
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
                    onReady?.()
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
                })
                .catch((err) => console.error("GLTF load error", err))
        })
        const maxTilt = THREE.MathUtils.degToRad(18)
        let targetTiltX = 0,
            targetTiltY = 0
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
            const delta = clock.getDelta()
            elapsed += delta
            if (spinningRef.current) {
                vinylObjs.forEach((obj) => {
                    obj.rotation.y += SPIN_SPEED * delta
                })
            }
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
            if (renderer.domElement.parentNode === mount)
                mount.removeChild(renderer.domElement)
        }
    }, [coverImageUrl, width, height])
    return (
        <div
            ref={mountRef}
            style={{ width, height, position: "relative", touchAction: "none" }}
        />
    )
}

function Film3DViewer({
    coverImageUrl,
    width,
    height,
    onReady,
}: {
    coverImageUrl: string
    width: number
    height: number
    onReady?: () => void
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
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        renderer.outputColorSpace = THREE.SRGBColorSpace
        renderer.toneMapping = THREE.ACESFilmicToneMapping
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
                        if (obj.name === "Object_6")
                            mats.forEach((m: any) => {
                                m.map = texture
                                m.color.set(0xffffff)
                                m.needsUpdate = true
                            })
                    })
                    const box = new THREE.Box3().setFromObject(model)
                    const center = box.getCenter(new THREE.Vector3())
                    model.position.sub(center)
                    tiltGroup.add(model)
                    onReady?.()
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
                })
                .catch((err) => console.error("GLTF load error", err))
        })
        const maxTilt = THREE.MathUtils.degToRad(18)
        let targetTiltX = 0,
            targetTiltY = 0
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
            if (renderer.domElement.parentNode === mount)
                mount.removeChild(renderer.domElement)
        }
    }, [coverImageUrl, width, height])
    return (
        <div
            ref={mountRef}
            style={{ width, height, position: "relative", touchAction: "none" }}
        />
    )
}

// ─── DVDCaseThumbnail (flat, used in grid/carousel front faces) ────────────
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

// ─── Spine dominant-color extraction (identical to desktop) ───────────────
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
                const ctx = canvas.getContext("2d")!
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
                const ctx = canvas.getContext("2d")!
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
                console.warn("spine sample failed:", url, e)
                resolve("#0c0c0c")
            }
        }
        img.onerror = () => resolve("#0c0c0c")
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
    const lighter = Math.max(l1, l2),
        darker = Math.min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)
}
function getContrastingSpineTextColor(rgbString: string): string {
    const [r, g, b] = blendWithOverlay(rgbString)
    const bgLum = relativeLuminance(r, g, b)
    const contrastWithDark = contrastRatio(bgLum, relativeLuminance(28, 28, 28))
    const contrastWithLight = contrastRatio(
        bgLum,
        relativeLuminance(254, 254, 254)
    )
    return contrastWithDark >= contrastWithLight
        ? "rgba(28,28,28,0.92)"
        : "rgba(254,254,254,0.95)"
}

// ─── IntroBanner (identical to desktop) ────────────────────────────────────
function IntroBanner({
    visible,
    onDismiss,
    theme,
    bottomOffset = 76,
}: {
    visible: boolean
    onDismiss: () => void
    theme: "light" | "dark"
    bottomOffset?: number
}) {
    const bannerBg = theme === "light" ? DARK : WHITE
    const bannerText = theme === "light" ? WHITE : DARK

    useEffect(() => {
        if (!visible) return
        const timer = window.setTimeout(() => {
            onDismiss()
        }, 3000)
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
                        delay: 0.7,
                        ease: [0.16, 1, 0.3, 1],
                    }}
                    style={{
                        position: "fixed",
                        left: "50%",
                        bottom: `calc(${bottomOffset}px + env(safe-area-inset-bottom, 0px))`,
                        x: "-50%",
                        display: "flex",
                        alignItems: "flex-start",
                        padding: "4px 0 20px",
                        gap: 12,
                        width: "calc(100% - 20px)",
                        maxWidth: 460,
                        background: bannerBg,
                        boxSizing: "border-box",
                        zIndex: 50,
                    }}
                >
                    <p
                        style={{
                            flex: 1,
                            margin: 0,
                            fontFamily: FONT,
                            fontWeight: 500,
                            fontSize: 14,
                            lineHeight: "20px",
                            color: bannerText,
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
                        }}
                    >
                        <Icon.Close color={bannerText} />
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    )
}

// ─── EntryAddedToast (identical to desktop, full-bleed width) ─────────────
interface ToastEntryData {
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
    theme,
    label = "New Entry Added",
    topOffset = 166,
}: {
    entry: ToastEntryData | null
    onClose: () => void
    theme: "light" | "dark"
    label?: string
    topOffset?: number
}) {
    const cardBg = theme === "light" ? DARK : WHITE
    const cardTextColor = theme === "light" ? WHITE : DARK
    const mutedCardTextColor =
    cardBg === WHITE ? "rgba(28,28,28,0.55)" : "rgba(254,254,254,0.55)"
    useEffect(() => {
        if (!entry) return
        const t = window.setTimeout(onClose, 4000)
        return () => clearTimeout(t)
    }, [entry, onClose])
    return (
        <AnimatePresence>
            {entry && (
                <motion.div
                    initial={{ opacity: 0, y: -16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -16 }}
                    transition={{ duration: 0.3 }}
                    onClick={() => {
                        playClickSound()
                        onClose()
                    }}
                    style={{
                        position: "fixed",
                        left: 12,
                        right: 12,
                        top: `calc(${topOffset}px + env(safe-area-inset-top, 0px))`,
                        zIndex: 10003,
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        background: cardBg,
                        paddingTop: 0,
paddingLeft: 0,
paddingBottom: 0,
paddingRight: 10,
                        boxSizing: "border-box",
                    }}
                >
                    <div
                        style={{
                            width: 64,
                            height: 64,
                            flexShrink: 0,
                            backgroundImage: entry.coverImageUrl
                                ? `url(${entry.coverImageUrl})`
                                : undefined,
                            backgroundColor: entry.coverImageUrl
                                ? undefined
                                : "rgba(128,128,128,0.2)",
                            backgroundSize: "cover",
                            backgroundPosition: "center",
                        }}
                    />
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            minWidth: 0,
                            flex: 1,
                        }}
                    >
                        <span
                            style={{
                                fontFamily: FONT,
                                fontWeight: 600,
                                fontSize: 12,
                                color: mutedCardTextColor,
                            }}
                        >
                            {label}
                        </span>
                        <span
                            style={{
                                fontFamily: FONT,
                                fontWeight: 500,
                                fontSize: 13,
                                color: cardTextColor,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                            }}
                        >
                            {entry.title} — {entry.creatorName}
                        </span>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    )
}

// ─── Carousel3D (identical logic to desktop — pointer-based drag already works with touch) ──
interface Carousel3DProps {
    images: ImageItem[]
    activeSearch?: boolean
    matchedEntryIds?: string[]
    itemWidth?: number
    itemHeight?: number
    edgeGap?: number
    filmItemWidth?: number
    filmEdgeGap?: number
    bookEdgeGap?: number
    perspective?: number
    tiltX?: number
    borderRadius?: number
    dragToRotate?: boolean
    dragSensitivity?: number
    spineDepth?: number
    filmSpineDepth?: number
    bookSpineDepth?: number
    spineTextEnabled?: boolean
    spineFontSize?: number
    spineFontWeight?: number
    rotationPerItem?: number
    coverflowDepth?: number
    autoRotate?: boolean
    autoRotateSpeed?: number
    paused?: boolean
    contrast?: number
    musicTextureImg?: string
    musicTextureOpacity?: number
    musicTextureBlend?: string
    filmSpineWidth?: number
    filmBorderRadius?: number
    filmTextureImg?: string
    filmTextureOpacity?: number
    filmTextureBlend?: string
    bookWidth?: number
    spineWidth?: number
    bookBorderRadius?: number
    textureImg?: string
    textureOpacity?: number
    textureBlend?: string
    activeCategory?: string
    theme?: "light" | "dark"
    onItemSelect?: (entryId: string | undefined) => void
}
function Carousel3D({
    images,
    activeSearch = false,
    matchedEntryIds = [],
    itemWidth = 220,
    itemHeight = 220,
    edgeGap = 12,
    filmItemWidth,
    filmEdgeGap,
    bookEdgeGap,
    perspective = 1000,
    tiltX = 0,
    borderRadius = 14,
    dragToRotate = true,
    dragSensitivity = 0.5,
    spineDepth = 24,
    filmSpineDepth,
    bookSpineDepth,
    spineTextEnabled = true,
    spineFontSize = 10,
    spineFontWeight = 600,
    rotationPerItem = 65,
    coverflowDepth = 70,
    autoRotate = false,
    autoRotateSpeed = 6,
    paused = false,
    contrast = 100,
    musicTextureImg,
    musicTextureOpacity = 100,
    musicTextureBlend = "screen",
    filmSpineWidth = 10,
    filmBorderRadius = 6,
    filmTextureImg,
    filmTextureOpacity = 100,
    filmTextureBlend = "screen",
    bookWidth = 220,
    spineWidth = 26,
    bookBorderRadius = 4,
    textureImg,
    textureOpacity = 100,
    textureBlend = "screen",
    activeCategory = "Music",
    theme = "dark",
    onItemSelect,
}: Carousel3DProps) {
    const isFilm = activeCategory === "Film"
    const isBook = activeCategory === "Books"
    const effItemWidth = isFilm
        ? (filmItemWidth ?? Math.min(itemWidth, 200))
        : isBook
          ? bookWidth
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

    const [filmSpineColors, setFilmSpineColors] = useState<
        Record<string, string>
    >({})
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

    const [musicSpineEdgeColors, setMusicSpineEdgeColors] = useState<
        Record<string, string>
    >({})
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
    const wheelContainerRef = useRef<HTMLDivElement | null>(null)
    const [viewportWidth, setViewportWidth] = useState(400)
    useEffect(() => {
        const el = wheelContainerRef.current
        if (!el) return
        const update = () => setViewportWidth(el.offsetWidth || 400)
        update()
        const ro = new ResizeObserver(update)
        ro.observe(el)
        return () => ro.disconnect()
    }, [])
    const neededSpan = viewportWidth * 3
    const repeatCount = Math.min(
        15,
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
    const pausedRef = useRef(paused)
    useEffect(() => {
        pausedRef.current = paused
    }, [paused])
    const [frontCol, setFrontCol] = useState(0)
    const frontColRef = useRef(0)

    const applyTransform = useCallback(() => {
        const raw = offsetRef.current
        const wrapped = raw - itemCountSafe * Math.round(raw / itemCountSafe)
        let nearestIdx = 0,
            nearestDist = Infinity
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
            el.style.transform = `translateX(${relativePx}px) translateZ(${depth}px) rotateY(${angle}deg)`
            el.style.zIndex = String(zIndex)
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
                // handled directly in the pointer handler
            } else if (Math.abs(velocity.current) > 0.5) {
                offsetRef.current += (velocity.current / itemSpacing) * dt
                velocity.current *= 0.92
                applyTransform()
            } else if (autoRotate && !pausedRef.current) {
                offsetRef.current += (autoRotateSpeed / itemSpacing) * dt
                applyTransform()
            }
            rafRef.current = requestAnimationFrame(tick)
        }
        rafRef.current = requestAnimationFrame(tick)
        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current)
        }
    }, [autoRotate, autoRotateSpeed, applyTransform])

    // Trackpad / mouse-wheel scroll — mirrors desktop for devices with a
    // wheel (e.g. iPad + trackpad, or a mobile browser in a resizable window)
    const dragSensitivityRef = useRef(dragSensitivity)
    useEffect(() => {
        dragSensitivityRef.current = dragSensitivity
    }, [dragSensitivity])
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
        )
            onItemSelect?.(clickCandidateRef.current)
        clickCandidateRef.current = undefined
    }

    const centeredSlot = images[frontCol]
    const infoBgColor = theme === "dark" ? WHITE : DARK
    const mutedInfoTextColor =
        infoBgColor === WHITE
            ? "rgba(254,254,254,0.55)"
            : "rgba(28,28,28,0.55)"

    return (
        <div
            ref={wheelContainerRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            style={{
                width: "100%",
                height: "100%",
                position: "relative",
                overflow: "hidden",
                perspective: `${perspective}px`,
                touchAction: dragToRotate ? "none" : "auto",
                cursor: dragToRotate ? "grab" : "default",
                userSelect: "none",
            }}
            onDragStart={(e) => e.preventDefault()}
        >
            <div
                style={{
                    position: "absolute",
                    left: "50%",
                    top: "50%",
                    width: effItemWidth,
                    height: effItemHeight,
                    transformStyle: "preserve-3d",
                    transform: `translate(-50%, -50%) rotateX(${tiltX}deg) rotateY(0deg)`,
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
                                if (isMatched)
                                    clickCandidateRef.current = img?.entryId
                            }}
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
                            }}
                        >
                            <div
                                style={{
                                    position: "absolute",
                                    inset: 0,
                                    backfaceVisibility: "hidden",
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
                                        ? "none"
                                        : "blur(10px) saturate(0.35) grayscale(1)",
                                    opacity: isMatched ? 1 : 0.18,
                                    transition:
                                        "filter 0.35s ease, opacity 0.35s ease",
                                }}
                            >
                                {isFilm
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
                                    : isBook
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
                                    borderRadius: !isBook ? borderRadius : 0,
                                    overflow:
                                        isFilm || isBook ? "visible" : "hidden",
                                    backgroundColor: "#111",
                                    backgroundImage:
                                        isFilm || isBook
                                            ? undefined
                                            : img?.src
                                              ? `url(${img.src})`
                                              : undefined,
                                    backgroundSize: "cover",
                                    backgroundPosition: "center",
                                    backfaceVisibility: "hidden",
                                    transform: `rotateY(180deg) translateZ(${effSpineDepth / 2}px)`,
                                    filter: isMatched
                                        ? "none"
                                        : "blur(10px) saturate(0.35) grayscale(1)",
                                    opacity: isMatched ? 1 : 0.18,
                                }}
                            >
                                {isFilm ? (
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
                                ) : isBook ? (
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
                                    <div
                                        style={{
                                            position: "absolute",
                                            inset: 0,
                                            background: "rgba(0,0,0,0.35)",
                                        }}
                                    />
                                )}
                            </div>

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
                                    transform: `rotateY(-90deg) translateZ(${effItemWidth / 2}px)`,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    filter: isMatched
                                        ? "none"
                                        : "blur(10px) saturate(0.35) grayscale(1)",
                                    opacity: isMatched ? 1 : 0.18,
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

                                {isBook &&
                                    spineTextEnabled &&
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
                                                ? filmSpineColors[
                                                      `${img.src}::${fraction.toFixed(3)}`
                                                  ]
                                                : undefined
                                            : isBook
                                              ? img?.src
                                                  ? spineColors[img.src]
                                                  : undefined
                                              : img?.src
                                                ? musicSpineEdgeColors[
                                                      `${img.src}::${fraction.toFixed(3)}`
                                                  ]
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
                                        return (
                                            <div
                                                style={{
                                                    position: "relative",
                                                    zIndex: 1,
                                                    writingMode: "vertical-rl",
                                                    textOrientation: "mixed",
                                                    color: effectiveTextColor,
                                                    fontFamily:
                                                        "'Spline Sans', sans-serif",
                                                    fontSize: spineFontSize,
                                                    fontWeight: spineFontWeight,
                                                    letterSpacing: 1,
                                                    textTransform: "uppercase",
                                                    whiteSpace: "nowrap",
                                                }}
                                            >
                                                {img.title}
                                            </div>
                                        )
                                    })()}
                            </div>
                        </div>
                    )
                })}
            </div>

            {centeredSlot &&
                !!(
                    centeredSlot.title ||
                    centeredSlot.creatorName ||
                    centeredSlot.type ||
                    centeredSlot.genre ||
                    centeredSlot.releaseYear
                ) && (
                    <div
                        style={{
                            position: "absolute",
                            left: "50%",
                            bottom: 8,
                            transform: "translateX(-50%)",
                            zIndex: 5,
                            pointerEvents: "none",
                            overflow: "hidden",
                            maxWidth: "90%",
                        }}
                    >
                        <AnimatePresence mode="wait" initial={false}>
                            <motion.div
                                key={frontCol}
                                initial={{ opacity: 0, x: 16 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -16 }}
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
                                        fontSize={13}
                                    />
                                )}
                                {centeredSlot.creatorName && (
                                    <InfoChip
                                        label={centeredSlot.creatorName}
                                        bg="transparent"
                                        textColor={infoBgColor}
                                        fontSize={13}
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
                                            gap: 0,
                                        }}
                                    >
                                        {centeredSlot.type && (
                                            <InfoChip
                                                label={centeredSlot.type}
                                                bg="transparent"
                                                textColor={mutedInfoTextColor}
                                                fontSize={13}
                                            />
                                        )}
                                        {centeredSlot.genre && (
                                            <InfoChip
                                                label={centeredSlot.genre}
                                                bg="transparent"
                                                textColor={mutedInfoTextColor}
                                                fontSize={13}
                                            />
                                        )}
                                        {centeredSlot.releaseYear && (
                                            <InfoChip
                                                label={String(
                                                    centeredSlot.releaseYear
                                                )}
                                                bg="transparent"
                                                textColor={mutedInfoTextColor}
                                                fontSize={13}
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

// ─── Static field data (identical to desktop) ──────────────────────────────
const TYPE_OPTIONS: Record<string, string[]> = {
    Music: ["Single", "Album", "EP", "Curated Playlist"],
    Film: ["Movie", "Series", "Documentary", "Short Film", "Mini Series"],
    Books: ["Nonfiction", "Fiction", "Poetry", "Graphic Novel"],
}
const GENRE_OPTIONS: Record<string, string[]> = {
    Music: [
        "Pop",
        "R&B",
        "Hip-Hop",
        "Jazz",
        "Classical",
        "Electronic",
        "Rock",
        "Afrobeats",
        "Indie",
        "Soul",
        "Blues",
        "Funk",
        "LoFi",
        "Disco",
        "Dance",
        "Dance Pop",
        "Adult Contemporary",
        "Contemporary",
        "Heavy Metal",
        "Amapiano",
        "High Life",
        "Acapella",
        "Beatbox",
        "K-Pop",
        "Country",
        "Art-pop",
        "Alternative",
        "Mixed genre",
    ],
    Film: [
        "Action",
        "Comedy",
        "Drama",
        "Horror",
        "Sci-Fi",
        "Thriller",
        "Romance",
        "Animation",
        "Fantasy",
        "Sitcom",
        "Crime",
        "Friendship",
        "Youth",
        "Coming Of Age",
        "Law",
        "Noir",
        "Dark Comedy",
        "Mystery",
        "Family",
        "Historical",
        "Melodrama",
        "Apocalypse",
        "Psychological",
        "Slice Of Life",
        "Political",
        "Medical",
        "Revenge",
        "Survival",
        "Sports",
        "Financial",
        "Suspense",
    ],
    Books: [
        "Literary Fiction",
        "Mystery",
        "Science Fiction",
        "Fantasy",
        "Self-Help",
        "History",
        "Philosophy",
        "Essays",
        "Thriller",
        "Romance",
        "Biography",
        "Autobiography",
        "Memoir",
        "Contemporary",
        "Erotic",
        "Adult",
        "Music",
        "Pop Culture",
        "Suspense",
        "Manga",
        "Webtoon",
        "Anime",
        "Historical",
        "Arts",
        "Design",
        "Creative",
        "Business",
        "Economics",
        "Finance",
        "True Crime",
    ],
}

function useFieldStyles(theme: "light" | "dark") {
    const textColor = theme === "light" ? WHITE : DARK
    const rowBg =
        theme === "light" ? "rgba(254,254,254,0.1)" : "rgba(28,28,28,0.1)"
    const rowBorder =
        theme === "light" ? "rgba(254,254,254,0.3)" : "rgba(28,28,28,0.3)"
    const chipBg =
        theme === "light" ? "rgba(254,254,254,0.10)" : "rgba(28,28,28,0.10)"
    const placeholderColor =
        theme === "light" ? "rgba(254,254,254,0.4)" : "rgba(28,28,28,0.4)"
    const toggleActiveBg = theme === "light" ? WHITE : DARK
    const toggleActiveText = theme === "light" ? DARK : WHITE
    const label: React.CSSProperties = {
        fontFamily: FONT,
        fontWeight: 500,
        fontSize: 14,
        lineHeight: "20px",
        color: textColor,
    }
    const fieldLabel: React.CSSProperties = {
        ...label,
        display: "inline-block",
        background: PINK,
        color: DARK,
        padding: "2px 0",
        width: "fit-content",
        textAlign: "left",
    }
    const input: React.CSSProperties = {
        fontFamily: FONT,
        fontWeight: 500,
        fontSize: 16,
        lineHeight: "20px",
        color: textColor,
        background: "transparent",
        border: "none",
        outline: "none",
        width: "100%",
        ["--placeholder-color" as any]: placeholderColor,
    }
    return {
        textColor,
        rowBg,
        rowBorder,
        chipBg,
        placeholderColor,
        toggleActiveBg,
        toggleActiveText,
        label,
        fieldLabel,
        input,
    }
}

function useViewportHeight() {
    const getHeight = () => {
        if (typeof window === "undefined") return 800
        // visualViewport reports the actual visible viewport on mobile
        // Safari/Chrome, unaffected by the address bar/toolbar showing or
        // hiding — window.innerHeight flips between those two states and
        // caused the detail sheet and entry sheet to land on different
        // heights depending on exactly when each one measured.
        return window.visualViewport?.height ?? window.innerHeight
    }
    const [vh, setVh] = useState(getHeight)
    useEffect(() => {
        const update = () => setVh(getHeight())
        update()
        const vv = window.visualViewport
        if (vv) {
            vv.addEventListener("resize", update)
            vv.addEventListener("scroll", update)
        }
        window.addEventListener("resize", update)
        window.addEventListener("orientationchange", update)
        return () => {
            if (vv) {
                vv.removeEventListener("resize", update)
                vv.removeEventListener("scroll", update)
            }
            window.removeEventListener("resize", update)
            window.removeEventListener("orientationchange", update)
        }
    }, [])
    return vh
}

// ─── BottomSheet — replaces the desktop 50vw side panel for narrow screens ──
function BottomSheet({
    visible,
    onClose,
    theme,
    title,
    titleIcon,
    maxHeightRatio = 0.88,
    hideCloseButton = false,
    zIndexBase = 10001,
    titleColor,
    titleFontSize = 15,
    children,
}: {
    visible: boolean
    onClose: () => void
    theme: "light" | "dark"
    title: string
    titleIcon?: React.ReactNode
    maxHeightRatio?: number
    hideCloseButton?: boolean
    zIndexBase?: number
    titleColor?: string
    titleFontSize?: number
    children: React.ReactNode
}) {
    const dragControls = useDragControls()
    const viewportHeight = useViewportHeight()
    const maxHeight = Math.round(viewportHeight * maxHeightRatio)
    const modalBg = theme === "light" ? DARK : WHITE
    const textColor = theme === "light" ? WHITE : DARK

    // Measure the panel's natural (unconstrained) height via an inner
    // wrapper that itself never has an explicit height set. We then apply
    // an explicit px height to the outer (transformed/fixed) panel —
    // Safari has a bug where `height: auto` on an element with a CSS
    // transform (which Framer Motion's drag/animate uses) doesn't shrink
    // to content reliably, so we avoid "auto" entirely.
    const innerRef = useRef<HTMLDivElement>(null)
    const [naturalHeight, setNaturalHeight] = useState(0)
    useEffect(() => {
        if (!visible) return
        const el = innerRef.current
        if (!el) return
        const update = () => setNaturalHeight(el.scrollHeight)
        update()
        const ro = new ResizeObserver(update)
        ro.observe(el)
        return () => ro.disconnect()
    }, [visible, children])

    const needsScroll = naturalHeight > maxHeight
    const panelHeight = naturalHeight > 0
        ? Math.min(naturalHeight, maxHeight)
        : maxHeight // fallback for first paint before measurement resolves

    const handleClose = () => {
        playClickSound()
        onClose()
    }
    useEffect(() => {
        if (!visible || typeof document === "undefined") return
        const prev = document.body.style.overflow
        document.body.style.overflow = "hidden"
        return () => {
            document.body.style.overflow = prev
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
                        transition={{ duration: 0.25 }}
                        onClick={handleClose}
                        style={{
                            position: "fixed",
                            inset: 0,
                            zIndex: zIndexBase,
                            background:
                                theme === "light"
                                    ? "rgba(254,254,254,0.5)"
                                    : "rgba(28,28,28,0.5)",
                            backdropFilter: "blur(8px)",
                            WebkitBackdropFilter: "blur(8px)",
                        }}
                    />
                    <motion.div
                        initial={{ y: "100%" }}
                        animate={{ y: 0 }}
                        exit={{ y: "100%" }}
                        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                        drag="y"
                        dragListener={false}
                        dragControls={dragControls}
                        dragConstraints={{ top: 0, bottom: 0 }}
                        dragElastic={{ top: 0, bottom: 0.4 }}
                        onDragEnd={(_, info) => {
                            if (info.offset.y > 90 || info.velocity.y > 600)
                                handleClose()
                        }}
                        style={{
                            position: "fixed",
                            left: 0,
                            right: 0,
                            bottom: 0,
                            zIndex: zIndexBase + 1,
                            width: "100%",
                            height: panelHeight,
                            maxHeight,
                            display: "flex",
                            flexDirection: "column",
                            background: modalBg,
                            overflow: "hidden",
                            touchAction: "none",
                            transition: "height 0.15s ease",
                        }}
                    >
                        <div ref={innerRef} style={{ display: "flex", flexDirection: "column" }}>
                            <div
                                style={{
                                    display: "flex",
                                    justifyContent: "center",
                                    padding: "10px 0 4px",
                                    cursor: "grab",
                                }}
                                onPointerDown={(e) => dragControls.start(e)}
                            >
                                <div
                                    style={{
                                        width: 36,
                                        height: 4,
                                        borderRadius: 2,
                                        background:
                                            theme === "light"
                                                ? "rgba(254,254,254,0.3)"
                                                : "rgba(28,28,28,0.3)",
                                    }}
                                />
                            </div>
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    padding: "4px 16px 12px",
                                    flexShrink: 0,
                                }}
                            >
                                <div
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 8,
                                    }}
                                >
                                    {titleIcon}
                                    <span
                                        style={{
                                            fontFamily: FONT,
                                            fontWeight: 600,
                                            fontSize: titleFontSize,
                                            color: titleColor ?? textColor,
                                        }}
                                    >
                                        {title}
                                    </span>
                                </div>
                                {!hideCloseButton && (
                                    <div
                                        onClick={handleClose}
                                        style={{
                                            width: 32,
                                            height: 32,
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            background: PINK,
                                            cursor: "pointer",
                                        }}
                                    >
                                        <Icon.Close color={DARK} />
                                    </div>
                                )}
                            </div>
                            <div
                                style={{
                                    overflowY: needsScroll ? "auto" : "visible",
                                    overflowX: "hidden",
                                    touchAction: "pan-y",
                                    padding: "0 16px",
                                    WebkitOverflowScrolling: "touch",
                                    maxHeight: needsScroll
                                        ? maxHeight - 60 // roughly subtract drag handle + header row
                                        : undefined,
                                }}
                            >
                                {children}
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    )
}

// ─── New Entry Sheet — same fields/order as desktop NewEntryModal ─────────
function NewEntrySheet({
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
    const st = useFieldStyles(theme)
    const [category, setCategory] = useState(defaultCategory)
    const [type, setType] = useState("")
    const [genres, setGenres] = useState<string[]>([])
    const [genreOpen, setGenreOpen] = useState(false)
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
    const [submitting, setSubmitting] = useState(false)
    const [showValidation, setShowValidation] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const errorColor = "#FF5C5C"

    const isFormValid =
        title.trim().length > 0 &&
        artist.trim().length > 0 &&
        type.trim().length > 0 &&
        genres.length > 0 &&
        releaseYear.trim().length > 0

    useEffect(() => {
        if (visible) {
            if (editingEntry) {
                setCategory(
                    REVERSE_CATEGORY_MAP[editingEntry.category] ||
                        defaultCategory
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
            setShowValidation(false)
            setType("")
            setGenres([])
            setGenreOpen(false)
            setGenreSearch("")
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
    }, [visible, defaultCategory, editingEntry])

    useEffect(() => {
        if (!genreOpen) setGenreSearch("")
    }, [genreOpen])
    const toggleGenre = (g: string) =>
        setGenres((prev) =>
            prev.includes(g)
                ? prev.filter((x) => x !== g)
                : prev.length >= 4
                  ? prev
                  : [...prev, g]
        )

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
                onClose()
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
                    if (!presignRes.ok)
                        throw new Error(`Presign failed: ${presignRes.status}`)
                    const { uploadUrl, publicUrl } = await presignRes.json()

                    const putRes = await fetch(uploadUrl, {
                        method: "PUT",
                        headers: { "Content-Type": coverFile.type },
                        body: coverFile,
                    })
                    if (!putRes.ok)
                        throw new Error(`Upload failed: ${putRes.status}`)
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
                onClose()
            } catch (insertError) {
                console.error(
                    editingEntry
                        ? "Entry update failed:"
                        : "Entry insert failed:",
                    insertError
                )
            }
        } finally {
            setSubmitting(false)
        }
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
                alignItems: "center",
                justifyContent: "flex-start",
                padding: "4px 4px 4px 0",
                flex: 1,
                minHeight: 28,
                background: active ? st.toggleActiveBg : st.rowBg,
                cursor: "pointer",
                textAlign: "left",
            }}
        >
            <span
                style={{
                    ...st.label,
                    fontSize: 14,
                    color: active ? st.toggleActiveText : st.textColor,
                }}
            >
                {label}
            </span>
        </div>
    )

    return (
    <BottomSheet
        visible={visible}
        onClose={onClose}
        theme={theme}
        title={editingEntry ? "Edit Entry" : "New Entry"}
        titleIcon={<Icon.Plus color={theme === "light" ? WHITE : DARK} />}
    >
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ display: "flex", flexDirection: "column" }}>
    <span style={st.fieldLabel}>Category</span>
    <div
        style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: 0,
        }}
    >
        {["Music", "Film", "Books"].map((c) =>
            toggleTab(c, category === c, () => {
                setCategory(c)
                setGenres([])
            })
        )}
    </div>
</div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={st.fieldLabel}>Type</span>
                    <div
                        style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(2, 1fr)",
                            gap: 0,
                            border: `1px solid ${showValidation && !type ? errorColor : "transparent"}`,
                        }}
                    >
                        {(TYPE_OPTIONS[category] || []).map((t) =>
                            toggleTab(t, type === t, () => setType(t))
                        )}
                    </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={st.fieldLabel}>Title</span>
                    <input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder={
                            category === "Music"
                                ? "e.g ANTI"
                                : category === "Film"
                                  ? "e.g The Bear"
                                  : "e.g The Hobbit"
                        }
                        className="mobile-field-input"
                        style={{
                            ...st.input,
                            padding: "14px 16px 14px 0",
                            background: st.rowBg,
                            borderBottom: `1px solid ${showValidation && !title.trim() ? errorColor : st.rowBorder}`,
                        }}
                    />
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={st.fieldLabel}>
                        {category === "Music"
                            ? "Artist"
                            : category === "Film"
                              ? "Creator/Writer/Director"
                              : "Author"}
                    </span>
                    <input
                        value={artist}
                        onChange={(e) => setArtist(e.target.value)}
                        placeholder={
                            category === "Music"
                                ? "e.g Rihanna"
                                : category === "Film"
                                  ? "e.g Christopher Storer"
                                  : "e.g J. R. R. Tolkien"
                        }
                        className="mobile-field-input"
                        style={{
                            ...st.input,
                            padding: "14px 16px 14px 0",
                            background: st.rowBg,
                            borderBottom: `1px solid ${showValidation && !artist.trim() ? errorColor : st.rowBorder}`,
                        }}
                    />
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={st.fieldLabel}>Genre</span>
                    <div style={{ position: "relative" }}>
                        <div
                            onClick={() => setGenreOpen((p) => !p)}
                            style={{
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 0",
    gap: 8,
    height: 46,
    overflow: "hidden",
    background: st.rowBg,
    borderBottom: `1px solid ${st.rowBorder}`,
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
        flexWrap: "nowrap",
        overflowX: "auto",
        overflowY: "hidden",
        flex: 1,
        height: "100%",
    }}
>
                                {genres.length === 0 ? (
                                    <span
                                        style={{
                                            ...st.label,
                                            fontSize: 14,
                                            color: st.placeholderColor,
                                        }}
                                    >
                                        Select genres
                                    </span>
                                ) : (
                                    genres.map((g) => (
                                        <div
                                            key={g}
                                            style={{
                                                display: "flex",
                                                flexDirection: "row",
                                                alignItems: "center",
                                                height: 34,
                                                padding: "0 8px",
                                                gap: 4,
                                                background: st.chipBg,
                                                boxSizing: "border-box",
                                                flexShrink: 0,
                                            }}
                                        >
                                            <span
                                                style={{
                                                    ...st.label,
                                                    fontSize: 13,
                                                }}
                                            >
                                                {g}
                                            </span>
                                            <div
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    playClickSound()
                                                    toggleGenre(g)
                                                }}
                                                style={{
                                                    width: 16,
                                                    height: 16,
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                    cursor: "pointer",
                                                }}
                                            >
                                                <Icon.Close
                                                    color={st.textColor}
                                                    size={12}
                                                />
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                            <Icon.Caret
                                color={st.textColor}
                                rotate={genreOpen ? 0 : -90}
                            />
                        </div>

                        {genreOpen && (
                            <div
                                style={{
                                    position: "relative",
                                    zIndex: 10,
                                    background:
                                        theme === "light" ? DARK : WHITE,
                                    overflow: "visible",
                                }}
                            >
                                <div
                                    style={{
                                        display: "flex",
                                        flexDirection: "row",
                                        alignItems: "center",
                                        gap: 8,
                                        padding: "10px 0",
                                        position: "sticky",
                                        top: 0,
                                        background:
                                            theme === "light" ? DARK : WHITE,
                                        zIndex: 1,
                                    }}
                                >
                                    <Icon.Search color={st.textColor} />
                                    <input
                                        value={genreSearch}
                                        onChange={(e) =>
                                            setGenreSearch(e.target.value)
                                        }
                                        onClick={(e) => e.stopPropagation()}
                                        placeholder={`e.g. ${(GENRE_OPTIONS[category] || []).slice(0, 3).join(", ")}`}
                                        className="mobile-field-input"
                                        style={{ ...st.input, padding: 0 }}
                                    />
                                </div>
                                <div
                                    style={{
                                        maxHeight: 150,
                                        overflowY: "auto",
                                    }}
                                >
                                    {(GENRE_OPTIONS[category] || [])
                                        .filter((g) => {
                                            const normalizedQuery =
                                                normalizeSearchText(
                                                    genreSearch.trim()
                                                )
                                            if (!normalizedQuery) return true
                                            const normalizedGenre =
                                                normalizeSearchText(g)
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
                                            const selected = genres.includes(g)
                                            const disabled =
                                                !selected && genres.length >= 4
                                            return (
                                                <div
                                                    key={g}
                                                    onClick={() => {
                                                        if (disabled) return
                                                        playClickSound()
                                                        toggleGenre(g)
                                                    }}
                                                    style={{
                                                        display: "flex",
                                                        alignItems: "center",
                                                        padding: "6px 0",
                                                        background: selected
                                                            ? st.rowBg
                                                            : "transparent",
                                                        cursor: disabled
                                                            ? "not-allowed"
                                                            : "pointer",
                                                        opacity: disabled
                                                            ? 0.4
                                                            : 1,
                                                    }}
                                                >
                                                    <span
                                                        style={{
                                                            ...st.label,
                                                            fontSize: 14,
                                                        }}
                                                    >
                                                        {g}
                                                    </span>
                                                </div>
                                            )
                                        })}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={st.fieldLabel}>Release year</span>
                    <input
                        value={releaseYear}
                        onChange={(e) => {
                            if (/^\d{0,4}$/.test(e.target.value))
                                setReleaseYear(e.target.value)
                        }}
                        placeholder="e.g 2016"
                        inputMode="numeric"
                        className="mobile-field-input"
                        style={{
                            ...st.input,
                            padding: "14px 16px 14px 0",
                            background: st.rowBg,
                            borderBottom: `1px solid ${showValidation && !releaseYear.trim() ? errorColor : st.rowBorder}`,
                        }}
                    />
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={st.fieldLabel}>Cover image</span>
                    <div
                        onClick={() => fileInputRef.current?.click()}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            height: 50,
                            overflow: "hidden",
                            background: st.rowBg,
                            border: `1px dashed ${st.rowBorder}`,
                            cursor: "pointer",
                            padding: "14px 0",
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
                            {coverPreview && (
                                <img
                                    src={coverPreview}
                                    alt=""
                                    style={{
                                        width: 34,
                                        height: 34,
                                        objectFit: "cover",
                                        flexShrink: 0,
                                    }}
                                />
                            )}
                            <span
                                style={{
                                    ...st.label,
                                    fontSize: 14,
                                    color: st.placeholderColor,
                                    overflow: "hidden",
                                    whiteSpace: "nowrap",
                                    textOverflow: "ellipsis",
                                }}
                            >
                                {coverFile
                                    ? coverFile.name
                                    : "Tap to upload cover image"}
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
                                    width: 28,
                                    height: 28,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    flexShrink: 0,
                                }}
                            >
                                <Icon.Close color={st.textColor} size={12} />
                            </div>
                        )}
                    </div>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (!file) return
                            setCoverFile(file)
                            setCoverPreview(URL.createObjectURL(file))
                        }}
                        style={{ display: "none" }}
                    />
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={st.fieldLabel}>URL</span>
                    <input
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder="Add URL link"
                        className="mobile-field-input"
                        style={{
                            ...st.input,
                            padding: "14px 16px 14px 0",
                            background: st.rowBg,
                            borderBottom: `1px solid ${st.rowBorder}`,
                        }}
                    />
                </div>
                {type === "Curated Playlist" && (
                    <div style={{ display: "flex", flexDirection: "column" }}>
                        <span style={st.fieldLabel}>Preview URL</span>
                        <input
                            value={previewUrl}
                            onChange={(e) => setPreviewUrl(e.target.value)}
                            placeholder="Paste a Spotify track link"
                            className="mobile-field-input"
                            style={{
                                ...st.input,
                                padding: "14px 16px 14px 0",
                                background: st.rowBg,
                                borderBottom: `1px solid ${st.rowBorder}`,
                            }}
                        />
                    </div>
                )}
                <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={st.fieldLabel}>Comments</span>
                    <textarea
                        value={comment}
                        onChange={(e) => {
                            if (e.target.value.length <= 200)
                                setComment(e.target.value)
                        }}
                        placeholder="What do you think of it?"
                        rows={3}
                        maxLength={200}
                        className="mobile-field-input"
                        style={{
                            ...st.input,
                            padding: "14px 16px 14px 0",
                            background: st.rowBg,
                            borderBottom: `1px solid ${st.rowBorder}`,
                            resize: "none",
                        }}
                    />
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
    <span style={st.fieldLabel}>Username</span>
    <div
        style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            padding: "14px 16px 14px 0",
            background: st.rowBg,
            borderBottom: `1px solid ${st.rowBorder}`,
        }}
    >
        <span style={{ ...st.input, width: "auto", flexShrink: 0 }}>
            @
        </span>
        <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Anonymous"
            className="mobile-field-input"
            style={{
                ...st.input,
                padding: 0,
                background: "transparent",
                border: "none",
            }}
        />
    </div>
</div>
                <div
                    style={{
                        display: "flex",
                        flexDirection: "row",
                        paddingTop: 4,
                    }}
                >
                    <div
                        onClick={() => {
                            playClickSound()
                            onClose()
                        }}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "flex-start",
                            padding: "12px 16px 24px 0",
                            flex: 1,
                            background: st.rowBg,
                            cursor: "pointer",
                        }}
                    >
                        <span style={{ ...st.label, fontSize: 14 }}>
                            Cancel
                        </span>
                    </div>
                    <div
                        onClick={handleSubmit}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "flex-start",
                            gap: 6,
                            padding: "12px 16px 24px 0",
                            flex: 1,
                            background: PINK,
                            cursor: submitting
                                ? "default"
                                : !isFormValid
                                  ? "not-allowed"
                                  : "pointer",
                            opacity: submitting ? 0.6 : !isFormValid ? 0.4 : 1,
                        }}
                    >
                        {submitting && <LoadingDots size={16} color={DARK} />}
                        <span
                            style={{ ...st.label, fontSize: 14, color: DARK }}
                        >
                            {submitting
                                ? editingEntry
                                    ? "Saving..."
                                    : "Submitting..."
                                : editingEntry
                                  ? "Save changes"
                                  : "Submit"}
                        </span>
                    </div>
                </div>
            </div>
        </BottomSheet>
    )
}

// ─── Filter Sheet — same fields as desktop FilterModal ────────────────────
function FilterSheet({
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
    const st = useFieldStyles(theme)
    const [types, setTypes] = useState<string[]>(
        initialType ? initialType.split(",").filter(Boolean) : []
    )
    const [genres, setGenres] = useState<string[]>(initialGenres)
    const [genreOpen, setGenreOpen] = useState(false)
    const [genreSearch, setGenreSearch] = useState("")
    const [year, setYear] = useState(initialYear)
    const [yearOpen, setYearOpen] = useState(false)
    const [yearSearch, setYearSearch] = useState("")

    useEffect(() => {
        if (!genreOpen) setGenreSearch("")
    }, [genreOpen])
    useEffect(() => {
        if (!yearOpen) setYearSearch("")
    }, [yearOpen])

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
            if (e.category === categoryValue && e.release_year)
                years.add(String(e.release_year))
        })
        return Array.from(years).sort((a, b) => Number(b) - Number(a))
    }, [entries, categoryValue])

    const toggleGenre = (g: string) =>
        setGenres((prev) =>
            prev.includes(g)
                ? prev.filter((x) => x !== g)
                : prev.length >= 4
                  ? prev
                  : [...prev, g]
        )
    const toggleType = (t: string) =>
        setTypes((prev) =>
            prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
        )
    const hasAny =
        types.length > 0 || genres.length > 0 || year.trim().length > 0

    const pill = (label: string, active: boolean, onClick: () => void) => (
        <div
            key={label}
            onClick={() => {
                playClickSound()
                onClick()
            }}
            style={{
                ...st.label,
                fontSize: 14,
                padding: "8px 12px",
                background: active ? st.toggleActiveBg : st.rowBg,
                color: active ? st.toggleActiveText : st.textColor,
                cursor: "pointer",
            }}
        >
            {label}
        </div>
    )

    return (
    <BottomSheet
        visible={visible}
        onClose={onClose}
        theme={theme}
        title="Filters"
        titleIcon={<Icon.Funnel color={theme === "light" ? WHITE : DARK} />}
    >
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                <div
                    style={{ display: "flex", flexDirection: "column", gap: 0 }}
                >
                    <span style={st.fieldLabel}>Type</span>
                    <div
                        style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(2, 1fr)",
                            gap: 0,
                        }}
                    >
                        {(TYPE_OPTIONS[activeCategory] || []).map((t) => {
                            const active = types.includes(t)
                            return (
                                <div
                                    key={t}
                                    onClick={() => {
                                        playClickSound()
                                        toggleType(t)
                                    }}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "flex-start",
                                        padding: "8px 4px 8px 0",
                                        minHeight: 36,
                                        background: active
                                            ? st.toggleActiveBg
                                            : st.rowBg,
                                        cursor: "pointer",
                                        textAlign: "left",
                                    }}
                                >
                                    <span
                                        style={{
                                            ...st.label,
                                            fontSize: 14,
                                            color: active
                                                ? st.toggleActiveText
                                                : st.textColor,
                                        }}
                                    >
                                        {t}
                                    </span>
                                </div>
                            )
                        })}
                    </div>
                </div>

                <div
                    style={{ display: "flex", flexDirection: "column", gap: 0 }}
                >
                    <span style={st.fieldLabel}>Genre</span>
                    <div style={{ position: "relative" }}>
                        <div
                            onClick={() => setGenreOpen((p) => !p)}
                            style={{
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 0",
    gap: 8,
    height: 46,
    overflow: "hidden",
    background: st.rowBg,
    borderBottom: `1px solid ${st.rowBorder}`,
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
        flexWrap: "nowrap",
        overflowX: "auto",
        overflowY: "hidden",
        flex: 1,
        height: "100%",
    }}
>
                                {genres.length === 0 ? (
                                    <span
                                        style={{
                                            ...st.label,
                                            fontSize: 14,
                                            color: st.placeholderColor,
                                        }}
                                    >
                                        Select genres
                                    </span>
                                ) : (
                                    genres.map((g) => (
                                        <div
                                            key={g}
                                            style={{
                                                display: "flex",
                                                flexDirection: "row",
                                                alignItems: "center",
                                                height: 34,
                                                padding: "0 8px",
                                                gap: 4,
                                                background: st.chipBg,
                                                boxSizing: "border-box",
                                                flexShrink: 0,
                                            }}
                                        >
                                            <span
                                                style={{
                                                    ...st.label,
                                                    fontSize: 13,
                                                }}
                                            >
                                                {g}
                                            </span>
                                            <div
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    playClickSound()
                                                    toggleGenre(g)
                                                }}
                                                style={{
                                                    width: 16,
                                                    height: 16,
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                    cursor: "pointer",
                                                }}
                                            >
                                                <Icon.Close
                                                    color={st.textColor}
                                                    size={12}
                                                />
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                            <Icon.Caret
                                color={st.textColor}
                                rotate={genreOpen ? 0 : -90}
                            />
                        </div>

                        {genreOpen && (
                            <div
                                style={{
                                    position: "relative",
                                    zIndex: 10,
                                    background:
                                        theme === "light" ? DARK : WHITE,
                                    overflow: "visible",
                                }}
                            >
                                <div
                                    style={{
                                        display: "flex",
                                        flexDirection: "row",
                                        alignItems: "center",
                                        gap: 8,
                                        padding: "10px 0",
                                        position: "sticky",
                                        top: 0,
                                        background:
                                            theme === "light" ? DARK : WHITE,
                                        zIndex: 1,
                                    }}
                                >
                                    <Icon.Search color={st.textColor} />
                                    <input
                                        value={genreSearch}
                                        onChange={(e) =>
                                            setGenreSearch(e.target.value)
                                        }
                                        onClick={(e) => e.stopPropagation()}
                                        placeholder={`e.g. ${(GENRE_OPTIONS[activeCategory] || []).slice(0, 3).join(", ")}`}
                                        className="mobile-field-input"
                                        style={{ ...st.input, padding: 0 }}
                                    />
                                </div>
                                <div
                                    style={{
                                        maxHeight: 150,
                                        overflowY: "auto",
                                    }}
                                >
                                    {(GENRE_OPTIONS[activeCategory] || [])
                                        .filter((g) => {
                                            const normalizedQuery =
                                                normalizeSearchText(
                                                    genreSearch.trim()
                                                )
                                            if (!normalizedQuery) return true
                                            const normalizedGenre =
                                                normalizeSearchText(g)
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
                                            const selected = genres.includes(g)
                                            const disabled =
                                                !selected && genres.length >= 4
                                            return (
                                                <div
                                                    key={g}
                                                    onClick={() => {
                                                        if (disabled) return
                                                        playClickSound()
                                                        toggleGenre(g)
                                                    }}
                                                    style={{
                                                        display: "flex",
                                                        alignItems: "center",
                                                        padding: "6px 0",
                                                        background: selected
                                                            ? st.rowBg
                                                            : "transparent",
                                                        cursor: disabled
                                                            ? "not-allowed"
                                                            : "pointer",
                                                        opacity: disabled
                                                            ? 0.4
                                                            : 1,
                                                    }}
                                                >
                                                    <span
                                                        style={{
                                                            ...st.label,
                                                            fontSize: 14,
                                                        }}
                                                    >
                                                        {g}
                                                    </span>
                                                </div>
                                            )
                                        })}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
                <div
                    style={{ display: "flex", flexDirection: "column", gap: 0 }}
                >
                    <span style={st.fieldLabel}>Release year</span>
                    <div style={{ position: "relative" }}>
                        <div
                            onClick={() => setYearOpen((p) => !p)}
                            style={{
                                display: "flex",
                                flexDirection: "row",
                                alignItems: "center",
                                justifyContent: "space-between",
                                padding: "14px 0",
                                height: 46,
                                background: st.rowBg,
                                borderBottom: `1px solid ${st.rowBorder}`,
                                cursor: "pointer",
                                boxSizing: "border-box",
                            }}
                        >
                            <span
                                style={{
                                    ...st.label,
                                    fontSize: 14,
                                    color: year
                                        ? st.textColor
                                        : st.placeholderColor,
                                }}
                            >
                                {year || "Any year"}
                            </span>
                            <Icon.Caret
                                color={st.textColor}
                                rotate={yearOpen ? 0 : -90}
                            />
                        </div>

                        {yearOpen && (
                            <div
                                style={{
                                    position: "relative",
                                    zIndex: 10,
                                    background:
                                        theme === "light" ? DARK : WHITE,
                                    overflow: "visible",
                                }}
                            >
                                <div
                                    style={{
                                        display: "flex",
                                        flexDirection: "row",
                                        alignItems: "center",
                                        gap: 8,
                                        padding: "10px 0",
                                        position: "sticky",
                                        top: 0,
                                        background:
                                            theme === "light" ? DARK : WHITE,
                                        zIndex: 1,
                                    }}
                                >
                                    <Icon.Search color={st.textColor} />
                                    <input
                                        value={yearSearch}
                                        onChange={(e) =>
                                            setYearSearch(e.target.value)
                                        }
                                        onClick={(e) => e.stopPropagation()}
                                        placeholder="Search year"
                                        className="mobile-field-input"
                                        style={{ ...st.input, padding: 0 }}
                                    />
                                </div>
                                <div
                                    style={{
                                        maxHeight: 150,
                                        overflowY: "auto",
                                    }}
                                >
                                    {(() => {
                                        const filteredYears =
                                            availableYears.filter((y) => {
                                                const normalizedQuery =
                                                    normalizeSearchText(
                                                        yearSearch.trim()
                                                    )
                                                if (!normalizedQuery)
                                                    return true
                                                return normalizeSearchText(
                                                    y
                                                ).includes(normalizedQuery)
                                            })
                                        if (filteredYears.length === 0) {
                                            return (
                                                <div
                                                    style={{
                                                        padding: "6px 0",
                                                    }}
                                                >
                                                    <span
                                                        style={{
                                                            ...st.label,
                                                            fontSize: 14,
                                                            color: st.placeholderColor,
                                                        }}
                                                    >
                                                        No years found
                                                    </span>
                                                </div>
                                            )
                                        }
                                        return filteredYears.map((y) => {
                                            const selected = year === y
                                            return (
                                                <div
                                                    key={y}
                                                    onClick={() => {
                                                        playClickSound()
                                                        setYear(
                                                            selected ? "" : y
                                                        )
                                                        setYearOpen(false)
                                                    }}
                                                    style={{
                                                        display: "flex",
                                                        alignItems: "center",
                                                        padding: "6px 0",
                                                        background: selected
                                                            ? st.rowBg
                                                            : "transparent",
                                                        cursor: "pointer",
                                                    }}
                                                >
                                                    <span
                                                        style={{
                                                            ...st.label,
                                                            fontSize: 14,
                                                        }}
                                                    >
                                                        {y}
                                                    </span>
                                                </div>
                                            )
                                        })
                                    })()}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
                <div
                    style={{
                        display: "flex",
                        flexDirection: "row",
                        paddingTop: 4,
                    }}
                >
                    {hasAny && (
                        <div
                            onClick={() => {
                                playClickSound()
                                setTypes([])
                                setGenres([])
                                setYear("")
                                onApply({ type: "", genres: [], year: "" })
                            }}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "flex-start",
                                padding: "12px 16px 24px 0",
                                flex: 1,
                                background: st.rowBg,
                                cursor: "pointer",
                            }}
                        >
                            <span style={{ ...st.label, fontSize: 14 }}>
                                Reset
                            </span>
                        </div>
                    )}
                    <div
                        onClick={() => {
                            playClickSound()
                            onApply({ type: types.join(","), genres, year })
                            onClose()
                        }}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "flex-start",
                            padding: "12px 16px 24px 0",
                            flex: 1,
                            background: hasAny ? PINK : st.rowBg,
                            cursor: hasAny ? "pointer" : "not-allowed",
                            opacity: hasAny ? 1 : 0.5,
                        }}
                    >
                        <span
                            style={{
                                ...st.label,
                                fontSize: 14,
                                color: hasAny ? DARK : st.textColor,
                            }}
                        >
                            Done
                        </span>
                    </div>
                </div>
            </div>
        </BottomSheet>
    )
}

// ─── Info Sheet — same copy as desktop InfoModal ───────────────────────────
function InfoSheet({
    visible,
    onClose,
    theme,
}: {
    visible: boolean
    onClose: () => void
    theme: "light" | "dark"
}) {
    const st = useFieldStyles(theme)
    return (
        <BottomSheet
            visible={visible}
            onClose={onClose}
            theme={theme}
            title="Info"
            maxHeightRatio={0.7}
        >
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 16,
                    paddingBottom: 24,
                }}
            >
                <p
                    style={{
                        margin: 0,
                        ...st.label,
                        fontSize: 14,
                        lineHeight: "20px",
                    }}
                >
                    No algorithm. No ads. Just real people sharing what they're
                    actually watching, listening to, and reading. This is a
                    community directory. See what others like and find something
                    new. If you have something worth sharing, feel free to add
                    it. Leave a comment and include a link. Your recommendations
                    are welcome here alongside everyone else's; no account
                    needed, no gatekeeping. The best recommendations come from
                    people, not machines. This is that.
                </p>
                <span style={{ ...st.label, fontSize: 14, opacity: 0.6 }}>
                    Designed and built by{" "}
                    <a
                        href="https://dee-space03.framer.website/"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                            ...st.label,
                            fontSize: 14,
                            textDecoration: "underline",
                        }}
                    >
                        Hamdiya
                    </a>
                </span>
            </div>
        </BottomSheet>
    )
}

function DeleteConfirmSheet({
    visible,
    onClose,
    onConfirm,
    theme,
    entryTitle,
}: {
    visible: boolean
    onClose: () => void
    onConfirm: () => void
    theme: "light" | "dark"
    entryTitle?: string
}) {
    const st = useFieldStyles(theme)
    const mutedTitleColor =
        theme === "light" ? "rgba(254,254,254,0.55)" : "rgba(28,28,28,0.55)"
    return (
        <BottomSheet
            visible={visible}
            onClose={onClose}
            theme={theme}
            title="Delete entry"
            maxHeightRatio={0.4}
            hideCloseButton
            zIndexBase={10011}
            titleColor={mutedTitleColor}
            titleFontSize={14}
        >
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 20,
                }}
            >
                <p
                    style={{
                        margin: 0,
                        ...st.label,
                        fontSize: 14,
                        lineHeight: "20px",
                    }}
                >
                    {entryTitle
                        ? `Are you sure you want to delete "${entryTitle}"? It can't be undone.`
                        : "Are you sure you want to delete this entry? It can't be undone."}
                </p>
                <div style={{ display: "flex", flexDirection: "row" }}>
                    <div
                        onClick={() => {
                            playClickSound()
                            onClose()
                        }}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "flex-start",
                            padding: "12px 16px 24px 0",
                            flex: 1,
                            background: st.rowBg,
                            cursor: "pointer",
                        }}
                    >
                        <span style={{ ...st.label, fontSize: 14 }}>
                            Cancel
                        </span>
                    </div>
                    <div
                        onClick={() => {
                            playClickSound()
                            onConfirm()
                        }}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "flex-start",
                            padding: "12px 16px 24px 0",
                            flex: 1,
                            background: PINK,
                            cursor: "pointer",
                        }}
                    >
                        <span
                            style={{ ...st.label, fontSize: 14, color: DARK }}
                        >
                            Delete
                        </span>
                    </div>
                </div>
            </div>
        </BottomSheet>
    )
}

// ─── Entry Detail Sheet — same Three.js viewers + preview audio as desktop, stacked layout ──
function EntryDetailSheet({
    visible,
    onClose,
    theme,
    entry,
    activeCategory,
    contrast,
    onEdit,
    onDelete,
}: {
    visible: boolean
    onClose: () => void
    theme: "light" | "dark"
    entry: Entry | null
    activeCategory: string
    contrast: number
    onEdit?: (entry: Entry) => void
    onDelete?: (entry: Entry) => void
}) {
    const st = useFieldStyles(theme)
    const artBoxRef = useRef<HTMLDivElement>(null)
    const [artW, setArtW] = useState(260)
    useEffect(() => {
        const el = artBoxRef.current
        if (!el) return
        const update = () => setArtW(el.offsetWidth || 260)
        update()
        const ro = new ResizeObserver(update)
        ro.observe(el)
        return () => ro.disconnect()
    }, [visible])

    const [previewStatus, setPreviewStatus] = useState("idle")
    const previewAudioRef = useRef<HTMLAudioElement | null>(null)

    useEffect(() => {
        previewAudioRef.current?.pause()
        previewAudioRef.current = null
        setPreviewStatus("idle")
        if (!visible || activeCategory !== "Music" || !entry) return
        let cancelled = false
        setPreviewStatus("loading")
        const resolvePreview = async () => {
            let url: string | null = null
            if (entry.subcategory === "curated_playlist" && entry.preview_url) {
                try {
                    const res = await fetch(
                        `https://open.spotify.com/oembed?url=${encodeURIComponent(entry.preview_url)}`
                    )
                    const data = await res.json()
                    if (data?.title)
                        url = await fetchItunesPreviewUrl(
                            data.title,
                            entry.creator_name
                        )
                } catch (e) {
                    console.log("spotify oembed failed", e)
                }
            } else {
                url = await fetchItunesPreviewUrl(
                    entry.title,
                    entry.creator_name
                )
            }
            console.log("resolvePreview got url:", url)
            if (cancelled) return
            if (!url) {
                setPreviewStatus("error")
                return
            }
            const audio = new Audio(url)
            audio.loop = true
            audio.volume = 0.6
            audio.preload = "auto"
            audio.addEventListener("error", (e) => {
                console.error("Audio element error event:", audio.error)
                if (!cancelled) setPreviewStatus("error")
            })
            audio.addEventListener("canplay", () => {
                console.log("Audio canplay fired")
            })
            previewAudioRef.current = audio
            setPreviewStatus("ready")
        }
        resolvePreview()
        return () => {
            cancelled = true
            previewAudioRef.current?.pause()
            previewAudioRef.current = null
        }
    }, [visible, entry, activeCategory])

    const togglePreview = () => {
        const audio = previewAudioRef.current
        if (!audio || previewStatus === "loading" || previewStatus === "error")
            return
        playClickSound()
        if (previewStatus === "playing") {
            audio.pause()
            setPreviewStatus("ready")
        } else {
            audio
                .play()
                .then(() => setPreviewStatus("playing"))
                .catch((err) => {
                    console.error(
                        "Preview play() rejected:",
                        err.name,
                        err.message
                    )
                    setPreviewStatus("error")
                })
        }
    }

    const [modelReady, setModelReady] = useState(false)
    useEffect(() => {
        setModelReady(false)
    }, [entry?.id, activeCategory])

    if (!entry) return null
    const img = entryToImageItem(entry)
    const typeLabel = toTitleCaseLabel(entry.subcategory ?? "")
    const genres = (entry.genre ?? "").split(",").filter(Boolean)
    const isMine = getMyEntryIds().includes(entry.id)
    const wideBoxWidth = Math.min(artW * 0.68, 230)
    const wideBoxHeight = wideBoxWidth / (589 / 374.09)
    const filmBoxWidth = Math.min(artW * 0.42, 150)
    const filmBoxHeight = filmBoxWidth * FILM_CASE_ASPECT
    const artSize = Math.min(artW * 0.6, 220)
    const artHeight = artSize

    const chipTextStyle: React.CSSProperties = {
    fontFamily: FONT,
    fontWeight: 500,
    fontSize: 14,
    lineHeight: "20px",
    textAlign: "left",
}
const mutedTextColor =
    theme === "light" ? "rgba(254,254,254,0.55)" : "rgba(28,28,28,0.55)"

    return (
        <BottomSheet
            visible={visible}
            onClose={onClose}
            theme={theme}
            title={img.title || "Details"}
            maxHeightRatio={0.8}
        >
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 24,
                    paddingBottom: 0,
                }}
            >
                <div
                    ref={artBoxRef}
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        position: "relative",
                        zIndex: 0,
                        marginTop:
                            activeCategory === "Music"
                                ? 24
                                : activeCategory === "Books"
                                  ? 32
                                  : activeCategory === "Film"
                                    ? 28
                                    : 24,
                    }}
                >
                    {activeCategory === "Music" ? (
                        <div
                            style={{
                                width: wideBoxWidth,
                                height: wideBoxHeight,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                            }}
                        >
                            <div
                                style={{
                                    transform: "scale(2.7)",
                                    transformOrigin: "center",
                                }}
                            >
                                <Vinyl3DViewer
                                    coverImageUrl={img.src}
                                    width={wideBoxWidth}
                                    height={wideBoxHeight}
                                    spinning={previewStatus === "playing"}
                                    onReady={() => setModelReady(true)}
                                />
                            </div>
                        </div>
                    ) : activeCategory === "Books" ? (
                        <div
                            style={{
                                width: wideBoxWidth,
                                height: wideBoxHeight,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                            }}
                        >
                            <div
                                style={{
                                    transform: "scale(2.2)",
                                    transformOrigin: "center",
                                }}
                            >
                                <Book3DViewer
                                    coverImageUrl={img.src}
                                    width={wideBoxWidth}
                                    height={wideBoxHeight}
                                    onReady={() => setModelReady(true)}
                                />
                            </div>
                        </div>
                    ) : activeCategory === "Film" ? (
                        <div
                            style={{
                                width: filmBoxWidth,
                                height: filmBoxHeight,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                            }}
                        >
                            <div
                                style={{
                                    transform: "scale(1.8)",
                                    transformOrigin: "center",
                                }}
                            >
                                <Film3DViewer
                                    coverImageUrl={img.src}
                                    width={filmBoxWidth}
                                    height={filmBoxHeight}
                                    onReady={() => setModelReady(true)}
                                />
                            </div>
                        </div>
                    ) : (
                        img.src && (
                            <img
                                src={img.src}
                                alt=""
                                style={{
                                    width: artSize,
                                    height: artHeight,
                                    objectFit: "cover",
                                    filter: `contrast(${contrast}%)`,
                                }}
                            />
                        )
                    )}
                    {!modelReady && (
                        <div
                            style={{
                                position: "absolute",
                                inset: 0,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                pointerEvents: "none",
                            }}
                        >
                            <LoadingDots size={28} color={st.textColor} />
                        </div>
                    )}
                </div>

                {activeCategory === "Music" && previewStatus !== "idle" && (
                    <div
                        onClick={togglePreview}
                        style={{
                            position: "relative",
                            zIndex: 1,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "flex-start",
                            gap: 8,
                            padding: "12px 16px 12px 0",
                            marginTop: 16,
                            background: st.rowBg,
                            cursor:
                                previewStatus === "loading" ||
                                previewStatus === "error"
                                    ? "default"
                                    : "pointer",
                            opacity:
                                previewStatus === "loading" ||
                                previewStatus === "error"
                                    ? 0.5
                                    : 1,
                        }}
                    >
                        <span style={{ ...st.label, fontSize: 14 }}>
                            {previewStatus === "loading"
                                ? "Loading preview..."
                                : previewStatus === "error"
                                  ? "Preview unavailable"
                                  : previewStatus === "playing"
                                    ? "Pause preview"
                                    : "Play preview"}
                        </span>
                    </div>
                )}

                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-start",
                        width: "100%",
                        gap: 32,
                        marginTop: 8,
                        textAlign: "left",
                    }}
                >
                    <div
    style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        width: "100%",
        textAlign: "left",
    }}
>
    {img.title && (
    <div
        style={{
            display: "flex",
            alignItems: "center",
            padding: "4px 0",
        }}
    >
        <span
            style={{
                ...chipTextStyle,
                color: st.textColor,
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
            alignItems: "center",
            padding: "4px 0",
        }}
    >
        <span
            style={{
                ...chipTextStyle,
                color: st.textColor,
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
            alignItems: "center",
            padding: "2px 0",
        }}
    >
        <span
            style={{
                ...chipTextStyle,
                color: mutedTextColor,
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
            flexWrap: "wrap",
            width: "100%",
        }}
    >
        {genres.map((g, i) => (
            <div
                key={g}
                style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    padding: "2px 0",
                    gap: 8,
                }}
            >
                <span
                    style={{
                        ...chipTextStyle,
                        color: mutedTextColor,
                    }}
                >
                    {g}
                </span>
                {i < genres.length - 1 && (
                    <span
                        style={{
                            ...chipTextStyle,
                            color: mutedTextColor,
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
            alignItems: "center",
            padding: "4px 0",
        }}
    >
        <span
            style={{
                ...chipTextStyle,
                color: mutedTextColor,
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
                                        ...chipTextStyle,
                                        color: st.textColor,
                                        lineHeight: "20px",
                                    }}
                                >
                                    "{entry.comment}"
                                </p>
                            )}
                            {img.posterName && (
    <span
        style={{
            ...chipTextStyle,
            color: st.textColor,
            opacity: 0.6,
        }}
    >
        Added by @{img.posterName}
    </span>
)}
                        </div>
                    )}
                </div>
                {(img.externalLink || isMine) && (
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "row",
                            flexWrap: "wrap",
                            alignItems: "center",
                            width: "100%",
                        }}
                    >
                        {isMine && (
                            <div
                                onClick={() => {
                                    playClickSound()
                                    onEdit?.(entry)
                                }}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "flex-start",
                                    padding: "12px 40px 16px 0",
                                    background: st.rowBg,
                                    cursor: "pointer",
                                }}
                            >
                                <span
                                    style={{
                                        ...chipTextStyle,
                                        color: st.textColor,
                                    }}
                                >
                                    Edit
                                </span>
                            </div>
                        )}
                        {isMine && (
                            <div
                                onClick={() => {
                                    playClickSound()
                                    onDelete?.(entry)
                                }}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "flex-start",
                                    padding: "12px 40px 16px 0",
                                    background: st.rowBg,
                                    cursor: "pointer",
                                }}
                            >
                                <span
                                    style={{
                                        ...chipTextStyle,
                                        color: st.textColor,
                                    }}
                                >
                                    Delete
                                </span>
                            </div>
                        )}
                        {img.externalLink && (
                            <ListenButton
                                href={img.externalLink}
                                label={getActionLabel(activeCategory)}
                            />
                        )}
                    </div>
                )}
            </div>
        </BottomSheet>
    )
}

// ─── GridCell — same layered 3D flip card as desktop, tap opens detail directly ──
interface GridCellProps {
    id: string
    leftPx: number
    topPx: number
    img: ImageItem
    isMatched: boolean
    isClicked: boolean
    entryOpen: boolean
    delay: number
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
    onCellClick: (id: string, entryId: string) => void
}
const GridCell = memo(function GridCell({
    id,
    leftPx,
    topPx,
    img,
    isMatched,
    isClicked,
    entryOpen,
    delay,
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
    onCellClick,
}: GridCellProps) {
    return (
        <motion.div
            initial={{ x: CONVERGE_X, y: CONVERGE_Y, scale: 0.15, opacity: 0 }}
            animate={{
                x: 0,
                y: 0,
                scale: isMatched ? 1 : 0.9,
                opacity: isClicked && entryOpen ? 0 : isMatched ? 1 : 0.2,
            }}
            whileTap={isMatched ? { scale: 0.96 } : undefined}
            exit={{
                x: CONVERGE_X,
                y: CONVERGE_Y,
                scale: 0.15,
                opacity: 0,
                transition: { duration: 0.4, delay, ease: [0.4, 0, 0.2, 1] },
            }}
            transition={{
                x: { duration: 0.45, delay, ease: [0.16, 1, 0.3, 1] },
                y: { duration: 0.45, delay, ease: [0.16, 1, 0.3, 1] },
                scale: { type: "spring", stiffness: 420, damping: 26 },
                opacity: { duration: 0.35, delay },
            }}
            style={{
                position: "absolute",
                left: leftPx,
                top: topPx,
                width: cellDisplayWidth,
                height: cellDisplayHeight,
                userSelect: "none",
                cursor: isMatched ? "pointer" : "default",
                pointerEvents: isMatched ? "auto" : "none",
                filter: isMatched
                    ? "none"
                    : `blur(6px) saturate(0.35) grayscale(1)`,
            }}
            onClick={() => {
                if (isMatched) onCellClick(id, img.entryId)
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
            >
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
                    <div
                        style={{
                            position: "absolute",
                            inset: 0,
                            background: "rgba(0,0,0,0.35)",
                        }}
                    />
                </div>

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
        </motion.div>
    )
})

// ─── Props ──────────────────────────────────────────────────────────────────
interface MobileProps {
    logoGroup: { logo?: string; logoDark?: string; logoHeight?: number }
    musicCD: {
        cellSize: number
        gap: number
        patternCols: number
        patternRows: number
        borderRadius: number
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
        contrast: number
        shadowIntensity: number
        noiseEnabled: boolean
        noiseOpacity: number
        noiseSize: number
        noiseBlend: string
    }
    carouselGroup: {
        musicSpineGroup?: {
            itemWidth: number
            itemHeight: number
            edgeGap: number
            spineDepth: number
        }
        filmSpineGroup?: {
            filmItemWidth: number
            filmEdgeGap: number
            filmSpineDepth: number
        }
        booksSpineGroup?: {
            bookItemWidth: number
            bookEdgeGap: number
            bookSpineDepth: number
        }
        rotationPerItem: number
        coverflowDepth: number
        perspective: number
        tiltX: number
        autoRotate: boolean
        autoRotateSpeed: number
        dragToRotate: boolean
        dragSensitivity: number
        borderRadius: number
    }
}

// ─── Main component ─────────────────────────────────────────────────────────
export default function InfiniteDragCanvasMobile(props: MobileProps) {
    const {
        logoGroup,
        musicCD,
        booksGroup,
        filmGroup,
        filtersGroup,
        carouselGroup,
    } = props
    const { logo, logoDark, logoHeight = 24 } = logoGroup || {}
    const {
        cellSize,
        gap,
        patternCols,
        patternRows,
        borderRadius,
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
        contrast,
        shadowIntensity,
        noiseEnabled,
        noiseOpacity,
        noiseSize,
        noiseBlend,
    } = filtersGroup || {}

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
    const [viewMode, setViewMode] = useState<"freeform" | "carousel">(
        "freeform"
    )
    const [searchValue, setSearchValue] = useState("")
    const [entries, setEntries] = useState<Entry[]>([])
    const [loadingEntries, setLoadingEntries] = useState(true)
    const [spineColors, setSpineColors] = useState<Record<string, string>>({})
    const [showNewEntry, setShowNewEntry] = useState(false)
    const [showFilters, setShowFilters] = useState(false)
    const [showInfo, setShowInfo] = useState(false)
    const [viewingEntry, setViewingEntry] = useState<Entry | null>(null)
    const [clickedKey, setClickedKey] = useState<string | null>(null)
    const [introVisible, setIntroVisible] = useState(true)
    const [toastEntry, setToastEntry] = useState<ToastEntryData | null>(null)
    const [duplicateToast, setDuplicateToast] = useState<ToastEntryData | null>(
        null
    )
    const [updatedToast, setUpdatedToast] = useState<ToastEntryData | null>(
        null
    )
    const [editingEntry, setEditingEntry] = useState<Entry | null>(null)
    const [deleteConfirmEntry, setDeleteConfirmEntry] = useState<Entry | null>(
        null
    )
    const [filtersByCategory, setFiltersByCategory] = useState<
        Record<string, { type: string; genres: string[]; year: string }>
    >({})

    const activeFilters = filtersByCategory[activeCategory] ?? DEFAULT_FILTERS
    const canvasBackground = theme === "light" ? WHITE : DARK
    const textColor = theme === "light" ? DARK : WHITE
    const panelBg =
        theme === "light" ? "rgba(28,28,28,0.06)" : "rgba(254,254,254,0.10)"

    const containerRef = useRef<HTMLDivElement>(null)
    const scatterRef = useRef<HTMLDivElement | null>(null)
    const toolbarRef = useRef<HTMLDivElement>(null)
    const [toolbarHeight, setToolbarHeight] = useState(52)
    const headerRef = useRef<HTMLDivElement>(null)
    const [headerHeight, setHeaderHeight] = useState(150)
    const x = useMotionValue(0)
    const y = useMotionValue(0)

    useEffect(() => {
        const el = toolbarRef.current
        if (!el) return
        const update = () => setToolbarHeight(el.offsetHeight || 52)
        update()
        const ro = new ResizeObserver(update)
        ro.observe(el)
        return () => ro.disconnect()
    }, [])

    useEffect(() => {
        const el = headerRef.current
        if (!el) return
        const update = () => setHeaderHeight(el.offsetHeight || 150)
        update()
        const ro = new ResizeObserver(update)
        ro.observe(el)
        return () => ro.disconnect()
    }, [])

    useEffect(() => {
        setViewingEntry(null)
    }, [activeCategory])

    useEffect(() => {
        setViewingEntry(null)
    }, [activeCategory])
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
    useEffect(() => {
        if (typeof document === "undefined") return
        document.body.style.backgroundColor = canvasBackground
        document.documentElement.style.backgroundColor = canvasBackground
    }, [canvasBackground])

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

    const normalizedSearch = useMemo(
        () => normalizeSearchText(searchValue.trim()),
        [searchValue]
    )
    const normalizedTypes = useMemo(
        () =>
            activeFilters.type
                .split(",")
                .map((t) => normalizeSearchText(t.trim()))
                .filter(Boolean),
        [activeFilters.type]
    )
    const normalizedGenres = useMemo(
        () =>
            activeFilters.genres
                .map((g) => normalizeSearchText(g.trim()))
                .filter(Boolean),
        [activeFilters.genres]
    )
    const selectedYear = activeFilters.year.trim()
    const hasActiveFilters =
        normalizedTypes.length > 0 ||
        normalizedGenres.length > 0 ||
        selectedYear.length > 0
    const hasActiveRefinement = normalizedSearch.length > 0 || hasActiveFilters

    const matchedEntries = useMemo(
        () =>
            entries.filter((entry) => {
                if (!entryMatchesSearch(entry, normalizedSearch)) return false
                if (normalizedTypes.length > 0) {
                    const ok = normalizedTypes.some((t) =>
                        textMatchesSearchLogic(
                            t,
                            entry.subcategory,
                            toTitleCaseLabel(entry.subcategory ?? "")
                        )
                    )
                    if (!ok) return false
                }
                if (normalizedGenres.length > 0) {
                    const entryGenres = (entry.genre ?? "")
                        .split(",")
                        .map((g) => normalizeSearchText(g.trim()))
                        .filter(Boolean)
                    if (!normalizedGenres.some((g) => entryGenres.includes(g)))
                        return false
                }
                if (
                    selectedYear &&
                    !textMatchesSearchLogic(
                        selectedYear,
                        entry.release_year ?? ""
                    )
                )
                    return false
                return true
            }),
        [
            entries,
            normalizedSearch,
            normalizedTypes,
            normalizedGenres,
            selectedYear,
        ]
    )
    const matchedEntryIds = useMemo(
        () => matchedEntries.map((e) => e.id),
        [matchedEntries]
    )
    const matchedEntryIdSet = useMemo(
        () => new Set(matchedEntryIds),
        [matchedEntryIds]
    )

    const filterCount =
        activeFilters.type.split(",").filter((t) => t.trim()).length +
        activeFilters.genres.length +
        (activeFilters.year.trim() ? 1 : 0)

    const bookHeight = bookWidth * BOOK_ASPECT
    const filmHeight = filmWidth * FILM_CASE_ASPECT
    const tileW =
        (activeCategory === "Books"
            ? Math.max(cellSize, bookWidth)
            : activeCategory === "Film"
              ? Math.max(cellSize, filmWidth)
              : cellSize) + gap
    const tileH =
        (activeCategory === "Books"
            ? Math.max(cellSize, bookHeight)
            : activeCategory === "Film"
              ? Math.max(cellSize, filmHeight)
              : cellSize) + gap
    const patternW = tileW * patternCols
    const patternH = tileH * patternRows
    const effSpineDepth =
        activeCategory === "Film"
            ? (filmFreeformSpineDepth ?? 20)
            : activeCategory === "Books"
              ? (bookFreeformSpineDepth ?? 20)
              : (musicFreeformSpineDepth ?? 20)
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

    const [filmSpineColors, setFilmSpineColors] = useState<
        Record<string, string>
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

    const entriesRef = useRef<Entry[]>([])
    useEffect(() => {
        entriesRef.current = entries
    }, [entries])

    const handleCellClick = useCallback((id: string, entryId: string) => {
        const fullEntry = entriesRef.current.find((e) => e.id === entryId)
        if (fullEntry) {
            setClickedKey(id)
            setViewingEntry(fullEntry)
        }
    }, [])

    const handleEditEntry = useCallback((entry: Entry) => {
        setViewingEntry(null)
        setClickedKey(null)
        setEditingEntry(entry)
        setShowNewEntry(true)
    }, [])

    const handleDeleteEntry = useCallback((entry: Entry) => {
        setDeleteConfirmEntry(entry)
    }, [])

    const handleConfirmDelete = useCallback(async () => {
        const entry = deleteConfirmEntry
        if (!entry) return
        setDeleteConfirmEntry(null)
        setViewingEntry(null)
        setClickedKey(null)
        setEntries((prev) => prev.filter((e) => e.id !== entry.id))
        removeMyEntryId(entry.id)
        try {
            await deleteEntry(entry.id)
        } catch (err) {
            console.error("Delete failed:", err)
        }
    }, [deleteConfirmEntry])

    const cells = useMemo(() => {
        const list: { col: number; row: number; img: ImageItem }[] = []
        if (!images.length) return list
        for (let r = -patternRows; r < patternRows * 2; r++) {
            for (let c = -patternCols; c < patternCols * 2; c++) {
                const pc = ((c % patternCols) + patternCols) % patternCols
                const pr = ((r % patternRows) + patternRows) % patternRows
                const idx = (pr * patternCols + pc) % images.length
                list.push({ col: c, row: r, img: images[idx] })
            }
        }
        return list
    }, [images, patternRows, patternCols])

    const hasNoResults = !loadingEntries && entries.length === 0

    return (
        <div
            ref={containerRef}
            style={{
                width: "100%",
                height: "100%",
                overflow: "hidden",
                position: "relative",
                background: canvasBackground,
                color: textColor,
                touchAction: "none",
                boxSizing: "border-box",
            }}
        >
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Spline+Sans:wght@300;400;500;600;700&family=Spline+Sans+Mono:wght@400;500;600&display=swap');
                .mobile-field-input::placeholder { color: var(--placeholder-color, #FEFEFE); opacity: 1; }
                .mobile-search-input::placeholder { color: var(--placeholder-color, #FEFEFE); opacity: 1; }
            `}</style>

            {/* Header — same functional elements as desktop, stacked for narrow width */}
            <div
                ref={headerRef}
                style={{
                    position: "fixed",
                    top: 0,
                    left: 0,
                    right: 0,
                    zIndex: 100,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    padding:
                        "max(20px, calc(10px + env(safe-area-inset-top, 0px))) 10px 0px",
                    background: canvasBackground,
                    boxSizing: "border-box",
                }}
            >
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                        minWidth: 0,
                    }}
                >
                    {logo ? (
                        <img
                            src={theme === "dark" ? logoDark || logo : logo}
                            alt="Thee Monolith Logo"
                            style={{
                                height: logoHeight,
                                maxWidth: 200,
                                objectFit: "contain",
                                flexShrink: 0,
                            }}
                        />
                    ) : (
                        <span
                            style={{
                                fontFamily: FONT,
                                fontWeight: 600,
                                fontSize: 15,
                                letterSpacing: 1,
                            }}
                        >
                            THEE = MONOLITH
                        </span>
                    )}
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                        }}
                    >
                        <div
                            onClick={() => {
                                playClickSound()
                                setTheme((t) =>
                                    t === "light" ? "dark" : "light"
                                )
                            }}
                            style={{
                                width: 32,
                                height: 32,
                                borderRadius: 0,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                background: panelBg,
                                cursor: "pointer",
                            }}
                        >
                            {theme === "dark" ? (
                                <Icon.Sun color={textColor} />
                            ) : (
                                <Icon.Moon color={textColor} />
                            )}
                        </div>
                        <div
                            onClick={() => {
                                playClickSound()
                                setShowInfo(true)
                            }}
                            style={{
                                width: 32,
                                height: 32,
                                borderRadius: 0,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                background: panelBg,
                                cursor: "pointer",
                            }}
                        >
                            <Icon.Info color={textColor} />
                        </div>
                        <div
                            onClick={() => {
                                playClickSound()
                                setEditingEntry(null)
                                setShowNewEntry(true)
                            }}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                                padding: "8px 16px 8px 0",
                                background: PINK,
                                cursor: "pointer",
                            }}
                        >
                            <Icon.Plus color={DARK} />
                            <span
                                style={{
                                    fontFamily: FONT,
                                    fontWeight: 500,
                                    fontSize: 14,
                                    color: DARK,
                                }}
                            >
                                New
                            </span>
                        </div>
                    </div>
                </div>

                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "10px 10px",
                        background: panelBg,
                        borderBottom: `1px solid ${
                            theme === "light"
                                ? "rgba(28,28,28,0.3)"
                                : "rgba(254,254,254,0.3)"
                        }`,
                    }}
                >
                    <Icon.Search color={textColor} />
                    <input
                        placeholder="Search"
                        value={searchValue}
                        onChange={(e) => setSearchValue(e.target.value)}
                        className="mobile-search-input"
                        style={
                            {
                                fontFamily: FONT,
                                fontWeight: 500,
                                fontSize: 16,
                                color: textColor,
                                background: "transparent",
                                border: "none",
                                outline: "none",
                                width: "100%",
                                ["--placeholder-color" as any]:
                                    theme === "light"
                                        ? "rgba(28,28,28,0.4)"
                                        : "rgba(254,254,254,0.4)",
                            } as React.CSSProperties
                        }
                    />
                </div>

                <div
                    style={{
                        display: "flex",
                        flexDirection: "row",
                        width: "100%",
                    }}
                >
                    {["Music", "Film", "Books"].map((cat) => {
                        const active = cat === activeCategory
                        return (
                            <div
                                key={cat}
                                onClick={() => {
                                    playClickSound()
                                    setActiveCategory(cat)
                                }}
                                style={{
                                    flex: 1,
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                    padding: "8px 16px 8px 0",
                                    background: active
                                        ? theme === "light"
                                            ? DARK
                                            : WHITE
                                        : panelBg,
                                    cursor: "pointer",
                                    boxSizing: "border-box",
                                }}
                            >
                                <Icon.Caret
                                    color={
                                        active
                                            ? theme === "light"
                                                ? WHITE
                                                : DARK
                                            : textColor
                                    }
                                    rotate={active ? 0 : -90}
                                />
                                <span
                                    style={{
                                        fontFamily: FONT,
                                        fontWeight: 500,
                                        fontSize: 14,
                                        color: active
                                            ? theme === "light"
                                                ? WHITE
                                                : DARK
                                            : textColor,
                                    }}
                                >
                                    {cat}
                                </span>
                            </div>
                        )
                    })}
                </div>

                <div
                    ref={toolbarRef}
                    style={{
                        position: "fixed",
                        left: 0,
                        right: 0,
                        bottom: 0,
                        zIndex: 100,
                        display: "flex",
                        flexDirection: "row",
                        alignItems: "flex-end",
                        gap: 6,
                        padding:
                            "0px 10px calc(10px + env(safe-area-inset-bottom, 0px))",
                        background: canvasBackground,
                        boxSizing: "border-box",
                    }}
                >
                    <div style={{ display: "flex", flex: 1 }}>
                        {(["freeform", "carousel"] as const).map((v) => {
                            const active = viewMode === v
                            return (
                                <div
                                    key={v}
                                    onClick={() => {
                                        playClickSound()
                                        setViewMode(v)
                                    }}
                                    style={{
                                        flex: 1,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "flex-start",
                                        padding: "4px 10px 20px 0",
                                        background: active
                                            ? theme === "light"
                                                ? DARK
                                                : WHITE
                                            : panelBg,
                                        cursor: "pointer",
                                        boxSizing: "border-box",
                                    }}
                                >
                                    <span
                                        style={{
                                            fontFamily: FONT,
                                            fontWeight: 500,
                                            fontSize: 14,
                                            color: active
                                                ? theme === "light"
                                                    ? WHITE
                                                    : DARK
                                                : textColor,
                                            textTransform: "capitalize",
                                            textAlign: "left",
                                        }}
                                    >
                                        {v}
                                    </span>
                                </div>
                            )
                        })}
                    </div>
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 0,
                        }}
                    >
                        {filterCount > 0 && (
                            <div
                                onClick={() => {
                                    playClickSound()
                                    setFiltersByCategory((prev) => ({
                                        ...prev,
                                        [activeCategory]: {
                                            type: "",
                                            genres: [],
                                            year: "",
                                        },
                                    }))
                                }}
                                style={{
                                    display: "flex",
                                    flexDirection: "row",
                                    alignItems: "center",
                                    justifyContent: "flex-start",
                                    gap: 6,
                                    padding: "4px 0",
                                    background:
                                        theme === "light" ? DARK : WHITE,
                                    cursor: "pointer",
                                }}
                            >
                                <Icon.Close
                                    color={theme === "light" ? WHITE : DARK}
                                    size={16}
                                />
                                <span
                                    style={{
                                        fontFamily: FONT,
                                        fontWeight: 500,
                                        fontSize: 14,
                                        color: theme === "light" ? WHITE : DARK,
                                    }}
                                >
                                    Clear
                                </span>
                            </div>
                        )}
                        <div
                            onClick={() => {
                                playClickSound()
                                setShowFilters(true)
                            }}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                padding: "4px 16px 20px 0",
                                background: PINK,
                                cursor: "pointer",
                            }}
                        >
                            <Icon.Funnel color={DARK} />
                            <span
                                style={{
                                    fontFamily: FONT,
                                    fontWeight: 500,
                                    fontSize: 14,
                                    color: DARK,
                                }}
                            >
                                {filterCount > 0
                                    ? `Filters [${filterCount}]`
                                    : "Filters"}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Freeform 3D drag canvas — identical structure to desktop, framer-motion drag already supports touch */}
            {viewMode === "freeform" && !loadingEntries && (
                <AnimatePresence mode="wait">
                    <motion.div
                        key="scattered"
                        ref={scatterRef}
                        drag
                        dragElastic={0}
                        dragMomentum
                        dragTransition={{
                            power: 0.35,
                            timeConstant: 280,
                            restDelta: 0.5,
                        }}
                        style={{
                            position: "absolute",
                            left: -patternW,
                            top: -patternH,
                            width: patternW * 3,
                            height: patternH * 3,
                            x,
                            y,
                            touchAction: "none",
                        }}
                    >
                        {cells.map(({ col, row, img }, i) => {
                            const id = `${col}-${row}`
                            const isMatched =
                                !hasActiveRefinement ||
                                matchedEntryIdSet.has(img.entryId)
                            const seed = Math.abs(
                                Math.sin(col * 12.9898 + row * 78.233)
                            )
                            const delay = (seed % 1) * 0.3
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
                                    leftPx={(col + patternCols) * tileW}
                                    topPx={(row + patternRows) * tileH}
                                    img={img}
                                    isMatched={isMatched}
                                    isClicked={id === clickedKey}
                                    entryOpen={!!viewingEntry}
                                    delay={delay}
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
                                    onCellClick={handleCellClick}
                                />
                            )
                        })}
                    </motion.div>
                </AnimatePresence>
            )}

            {/* 3D Carousel — identical component to desktop */}
            {viewMode === "carousel" && !loadingEntries && (
                <div
                    style={{
                        position: "fixed",
                        left: 0,
                        right: 0,
                        top: 150,
                        bottom: 60,
                    }}
                >
                    <Carousel3D
                        images={images}
                        activeSearch={hasActiveRefinement}
                        matchedEntryIds={matchedEntryIds}
                        itemWidth={
                            carouselGroup?.musicSpineGroup?.itemWidth ??
                            Math.min(cellSize, 200)
                        }
                        itemHeight={
                            carouselGroup?.musicSpineGroup?.itemHeight ??
                            Math.min(cellSize, 200)
                        }
                        edgeGap={carouselGroup?.musicSpineGroup?.edgeGap ?? 16}
                        filmItemWidth={
                            carouselGroup?.filmSpineGroup?.filmItemWidth
                        }
                        filmEdgeGap={carouselGroup?.filmSpineGroup?.filmEdgeGap}
                        bookEdgeGap={
                            carouselGroup?.booksSpineGroup?.bookEdgeGap
                        }
                        perspective={carouselGroup?.perspective ?? 900}
                        tiltX={carouselGroup?.tiltX ?? 0}
                        borderRadius={borderRadius}
                        dragToRotate={carouselGroup?.dragToRotate ?? true}
                        dragSensitivity={carouselGroup?.dragSensitivity ?? 0.5}
                        spineDepth={
                            carouselGroup?.musicSpineGroup?.spineDepth ?? 20
                        }
                        filmSpineDepth={
                            carouselGroup?.filmSpineGroup?.filmSpineDepth
                        }
                        bookSpineDepth={
                            carouselGroup?.booksSpineGroup?.bookSpineDepth
                        }
                        rotationPerItem={carouselGroup?.rotationPerItem ?? 65}
                        coverflowDepth={carouselGroup?.coverflowDepth ?? 70}
                        autoRotate={carouselGroup?.autoRotate ?? false}
                        autoRotateSpeed={carouselGroup?.autoRotateSpeed ?? 6}
                        paused={!!viewingEntry}
                        contrast={contrast}
                        musicTextureImg={musicTextureImg}
                        musicTextureOpacity={musicTextureOpacity}
                        musicTextureBlend={musicTextureBlend}
                        filmSpineWidth={filmSpineWidth}
                        filmBorderRadius={filmBorderRadius}
                        filmTextureImg={filmTextureImg}
                        filmTextureOpacity={filmTextureOpacity}
                        filmTextureBlend={filmTextureBlend}
                        bookWidth={
                            carouselGroup?.booksSpineGroup?.bookItemWidth ??
                            Math.min(bookWidth, 200)
                        }
                        spineWidth={spineWidth}
                        bookBorderRadius={bookBorderRadius}
                        textureImg={textureImg}
                        textureOpacity={textureOpacity}
                        textureBlend={bookTextureBlend}
                        activeCategory={activeCategory}
                        theme={theme}
                        onItemSelect={(entryId) => {
                            const fullEntry = entries.find(
                                (e) => e.id === entryId
                            )
                            if (fullEntry) setViewingEntry(fullEntry)
                        }}
                    />
                </div>
            )}

            {loadingEntries && (
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "80px 24px",
                        fontFamily: FONT,
                        fontSize: 13,
                        opacity: 0.5,
                    }}
                >
                    Loading entries...
                </div>
            )}
            {hasNoResults && (
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        top: 150,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "24px",
                        textAlign: "center",
                        fontFamily: FONT,
                        fontSize: 13,
                        opacity: 0.5,
                        pointerEvents: "none",
                    }}
                >
                    No entries yet for this category
                </div>
            )}

            <IntroBanner
                visible={introVisible}
                onDismiss={() => setIntroVisible(false)}
                theme={theme}
                bottomOffset={toolbarHeight}
            />

            <NewEntrySheet
                visible={showNewEntry}
                onClose={() => {
                    setShowNewEntry(false)
                    setEditingEntry(null)
                }}
                theme={theme}
                defaultCategory={activeCategory}
                entries={entries}
                editingEntry={editingEntry}
                onDuplicate={(existing) =>
                    setDuplicateToast({
                        title: existing.title,
                        creatorName: existing.creator_name,
                        coverImageUrl: existing.cover_image_url,
                        type: toTitleCaseLabel(existing.subcategory),
                        genre: existing.genre
                            ? existing.genre.split(",")[0]
                            : undefined,
                        releaseYear: existing.release_year,
                    })
                }
                onSubmitted={(entry) => {
                    if (editingEntry) {
                        setEntries((prev) =>
                            prev.map((e) => (e.id === entry.id ? entry : e))
                        )
                        setEditingEntry(null)
                        setUpdatedToast({
                            title: entry.title,
                            creatorName: entry.creator_name,
                            coverImageUrl: entry.cover_image_url,
                            type: toTitleCaseLabel(entry.subcategory),
                            genre: entry.genre
                                ? entry.genre.split(",")[0]
                                : undefined,
                            releaseYear: entry.release_year,
                        })
                        return
                    }
                    if (entry.category === CATEGORY_MAP[activeCategory])
                        setEntries((prev) => [entry, ...prev])
                    addMyEntryId(entry.id)
                    setToastEntry({
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
            <FilterSheet
                visible={showFilters}
                onClose={() => setShowFilters(false)}
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
            <InfoSheet
                visible={showInfo}
                onClose={() => setShowInfo(false)}
                theme={theme}
            />
            <EntryDetailSheet
                visible={!!viewingEntry}
                onClose={() => {
                    setViewingEntry(null)
                    setClickedKey(null)
                }}
                theme={theme}
                entry={viewingEntry}
                activeCategory={activeCategory}
                contrast={contrast}
                onEdit={handleEditEntry}
                onDelete={handleDeleteEntry}
            />
            <DeleteConfirmSheet
                visible={!!deleteConfirmEntry}
                onClose={() => setDeleteConfirmEntry(null)}
                onConfirm={handleConfirmDelete}
                theme={theme}
                entryTitle={deleteConfirmEntry?.title}
            />

            <EntryAddedToast
                entry={toastEntry}
                onClose={() => setToastEntry(null)}
                theme={theme}
                topOffset={headerHeight + 16}
            />
            <EntryAddedToast
                entry={duplicateToast}
                onClose={() => setDuplicateToast(null)}
                theme={theme}
                label="Already In Directory"
                topOffset={headerHeight + 16}
            />
            <EntryAddedToast
                entry={updatedToast}
                onClose={() => setUpdatedToast(null)}
                theme={theme}
                label="Entry Updated"
                topOffset={headerHeight + 16}
            />
        </div>
    )
}

export const MOBILE_DEFAULT_PROPS: MobileProps = {
    logoGroup: { logo: undefined, logoDark: undefined, logoHeight: 24 },
    musicCD: {
        cellSize: 130,
        gap: 14,
        patternCols: 4,
        patternRows: 5,
        borderRadius: 999,
        spineDepth: 20,
        textureImg: undefined,
        textureOpacity: 100,
        textureBlend: "screen",
    },
    booksGroup: {
        width: 150,
        spineWidth: 14,
        borderRadius: 4,
        spineDepth: 20,
        textureImg: undefined,
        textureOpacity: 100,
        textureBlend: "screen",
    },
    filmGroup: {
        width: 150,
        spineWidth: 6,
        borderRadius: 6,
        spineDepth: 20,
        textureImg: undefined,
        textureOpacity: 100,
        textureBlend: "screen",
    },
    filtersGroup: {
        contrast: 100,
        shadowIntensity: 0,
        noiseEnabled: false,
        noiseOpacity: 18,
        noiseSize: 180,
        noiseBlend: "overlay",
    },
    carouselGroup: {
        musicSpineGroup: {
            itemWidth: 180,
            itemHeight: 180,
            edgeGap: 16,
            spineDepth: 20,
        },
        filmSpineGroup: {
            filmItemWidth: 150,
            filmEdgeGap: 16,
            filmSpineDepth: 20,
        },
        booksSpineGroup: {
            bookItemWidth: 150,
            bookEdgeGap: 16,
            bookSpineDepth: 20,
        },
        rotationPerItem: 65,
        coverflowDepth: 70,
        perspective: 900,
        tiltX: 0,
        autoRotate: false,
        autoRotateSpeed: 6,
        dragToRotate: true,
        dragSensitivity: 0.5,
        borderRadius: 14,
    },
}
