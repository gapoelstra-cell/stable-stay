import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  MapPin, Star, Users, TreePine, Droplets, ShieldCheck, ChevronLeft, ChevronRight,
  Search, SlidersHorizontal, Award, Clock, Sparkles, Heart, Fence,
  Home as HomeIcon, Quote, X, LocateFixed, Map as MapIcon, List as ListIcon, Navigation,
  ZoomIn, ZoomOut, RotateCcw, LogOut, Mail, Lock, User as UserIcon, Plus, Trash2
} from "lucide-react";

/* ---------------------------------- DATA ---------------------------------- */

// Each barn can optionally carry a `photos` object with real image URLs:
//   photos: { exterior: "https://...", pasture: "https://...", arena: "https://...", detail: "https://..." }
// Only use images you have the rights to (your own photos, or a properly
// licensed source). Any slot left out — or any URL that fails to load —
// automatically falls back to the illustrated version.
// ---------------------------- SUPABASE CONNECTION ----------------------------
// This artifact sandbox can't install the @supabase/supabase-js package, so
// instead we talk to Supabase's own REST APIs directly with fetch() — that's
// a fully supported way to use Supabase, just a bit more manual.
const SUPABASE_URL = "https://atlsgkkakyemaoctbwvl.supabase.co";
const SUPABASE_KEY = "sb_publishable_OGHBTOWGGtRBxsiBAIeSMA_xAlaGiDk";

async function supabaseAuthRequest(path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/auth/v1${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("Request timed out after 10s — this preview sandbox may be blocking outbound network calls to Supabase. This should work once deployed.");
    }
    throw new Error("Network error reaching Supabase: " + (err.message || "unknown error"));
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.msg || data.error || "Something went wrong");
  return data;
}

function supabaseSignUp({ email, password, role, fullName }) {
  return supabaseAuthRequest("/signup", {
    email,
    password,
    data: { role, full_name: fullName },
  });
}

function supabaseLogin({ email, password }) {
  return supabaseAuthRequest("/token?grant_type=password", { email, password });
}

function supabaseRefresh(refreshToken) {
  return supabaseAuthRequest("/token?grant_type=refresh_token", { refresh_token: refreshToken });
}

async function supabaseLogout(accessToken) {
  await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${accessToken}` },
  }).catch(() => {});
}

async function fetchProfile(userId, accessToken) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=*`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${accessToken}` },
  });
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] : null;
}

// Best-effort geocoding so a barn owner only has to type a town and state —
// they never have to know or enter latitude/longitude themselves. If this
// fails (no internet, address not found, etc.) the barn still saves fine,
// it just won't have a map pin yet.
async function geocodeTownState(town, state) {
  try {
    const query = encodeURIComponent(`${town}, ${state}, USA`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await res.json();
    if (data && data[0]) {
      return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
    }
  } catch {
    // geocoding is a nice-to-have, not required for saving the barn
  }
  return { lat: null, lon: null };
}

async function createBarn(barn, accessToken) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/barns`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${accessToken}`,
      Prefer: "return=representation",
    },
    body: JSON.stringify(barn),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || "Couldn't save that barn");
  return Array.isArray(data) ? data[0] : data;
}

async function fetchMyBarns(ownerId, accessToken) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/barns?owner_id=eq.${ownerId}&select=*&order=created_at.desc`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${accessToken}` } }
  );
  const data = await res.json().catch(() => []);
  return Array.isArray(data) ? data : [];
}

async function deleteBarn(barnId, accessToken) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/barns?id=eq.${barnId}`, {
    method: "DELETE",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || "Couldn't delete that barn");
  }
}

// A small curated palette so real, owner-submitted barns still get a
// pleasant, consistent illustration even though owners never pick colors
// themselves — picked deterministically from the barn's own id.
const ACCENT_PALETTE = [
  { accent: "#4C6B4F", sky: "#8FAE8C" },
  { accent: "#8A5A2B", sky: "#E7B673" },
  { accent: "#3E6E6A", sky: "#A9CFC7" },
  { accent: "#43506B", sky: "#C7D2E3" },
  { accent: "#6B4C6E", sky: "#C9B7CE" },
  { accent: "#7A3B2E", sky: "#E3AE8C" },
  { accent: "#B08A2E", sky: "#F0D98C" },
];

function colorsForId(id) {
  let hash = 0;
  for (let i = 0; i < String(id).length; i++) hash = (hash * 31 + String(id).charCodeAt(i)) >>> 0;
  return ACCENT_PALETTE[hash % ACCENT_PALETTE.length];
}

// Real database rows don't have every field the demo data has (no reviews
// system yet, no chosen illustration colors) — this fills in sensible
// defaults so real barns render with the exact same components as demo ones.
function mapDbBarnToAppShape(row) {
  const colors = colorsForId(row.id);
  return {
    id: row.id,
    name: row.name,
    keeper: row.profiles?.full_name || "the owner",
    town: row.town,
    state: row.state,
    price: row.price,
    board: row.board_type,
    stalls: row.stalls,
    established: row.created_at ? new Date(row.created_at).getFullYear() : null,
    rating: null,
    reviews: 0,
    lat: row.lat,
    lon: row.lon,
    accent: colors.accent,
    sky: colors.sky,
    tags: row.tags || [],
    turnout: row.turnout || "Not specified yet",
    arena: row.arena || "Not specified yet",
    trails: row.trails || "Not specified yet",
    tagline: row.tagline || "",
    story: row.story || "",
    amenities: row.amenities || [],
    isReal: true,
  };
}

async function fetchAllBarns() {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/barns?select=*,profiles(full_name)&order=created_at.desc`,
      { headers: { apikey: SUPABASE_KEY } }
    );
    const rows = await res.json();
    if (!Array.isArray(rows)) return [];
    return rows.map(mapDbBarnToAppShape);
  } catch {
    // if this fails (offline, sandboxed preview, etc.) the app just shows
    // the demo barns — never a broken page
    return [];
  }
}

const BARNS = [
  {
    id: "willow-creek",
    name: "Willow Creek Farm",
    keeper: "Marge Callahan",
    town: "Turnbridge",
    state: "VT",
    price: 640,
    board: "Full Care",
    stalls: 3,
    established: 1998,
    rating: 4.9,
    reviews: 62,
    lat: 43.907,
    lon: -72.514,
    accent: "#4C6B4F",
    sky: "#8FAE8C",
    tags: ["Indoor Arena", "24/7 Turnout", "Trainer On-Site"],
    turnout: "Turned out 12+ hrs daily, run-in sheds in every pasture",
    arena: "80x180 indoor, lit outdoor dressage court",
    trails: "Direct access to 40 miles of state forest trail",
    tagline: "A quiet valley barn built around routine and turnout.",
    story:
      "Willow Creek has been in the Callahan family for three generations. Marge runs a small, deliberately quiet operation — no more than fourteen horses at a time — with a strong emphasis on turnout and low-stress herd living. Feed is weighed, not eyeballed, and every horse gets a hand-walk on rest days.",
    amenities: ["Heated wash stall", "Tack lockers", "On-site vet visits weekly", "Hay net feeding", "Blanketing service"],
  },
  {
    id: "copper-oak",
    name: "Copper Oak Stables",
    keeper: "Desmond Ruiz",
    town: "Fairhollow",
    state: "KY",
    price: 890,
    board: "Full Care",
    stalls: 5,
    established: 2011,
    rating: 4.8,
    reviews: 104,
    lat: 38.041,
    lon: -84.729,
    accent: "#8A5A2B",
    sky: "#E7B673",
    tags: ["Indoor Arena", "Show Prep", "Trainer On-Site"],
    turnout: "Individual paddocks, 6-8 hrs, weather dependent",
    arena: "100x220 indoor with mirrors, two outdoor rings",
    trails: "None on-site — 10 min trailer to county trailhead",
    tagline: "Serious training program in classic bluegrass country.",
    story:
      "Copper Oak is built for the show-bound horse. Desmond and two assistant trainers run a structured program of flatwork, jump schooling, and conditioning sets. It's not a turn-out-and-forget kind of place — expect your horse to be in consistent, tracked work.",
    amenities: ["Full grooming service", "Clipper & braiding on request", "Equine treadmill", "Show hauling available", "Video review of rides"],
  },
  {
    id: "salt-marsh",
    name: "Salt Marsh Equestrian",
    keeper: "Priya Anand",
    town: "Osprey Landing",
    state: "SC",
    price: 525,
    board: "Pasture Board",
    stalls: 8,
    established: 2016,
    rating: 4.7,
    reviews: 41,
    lat: 33.444,
    lon: -79.123,
    accent: "#3E6E6A",
    sky: "#A9CFC7",
    tags: ["Herd Living", "Beach Access", "Budget Friendly"],
    turnout: "24/7 group pasture, run-in shelters",
    arena: "Small outdoor schooling ring, no jumps set",
    trails: "Tidal marsh trails, seasonal beach rides at low tide",
    tagline: "Herd-life boarding minutes from the coast.",
    story:
      "Salt Marsh is for the owner who wants their horse to just be a horse. Herds are kept small and stable, hooves get a natural trim cycle, and there's no arena pressure — just wide-open pasture and, on the right tide, a ride down to the sand.",
    amenities: ["Round pen", "Self-serve tack shed", "Farrier on rotation", "Fly spray station", "Trailer parking"],
  },
  {
    id: "north-star",
    name: "North Star Ranch",
    keeper: "the Hollis family",
    town: "Elkhorn Pass",
    state: "MT",
    price: 410,
    board: "Self Care",
    stalls: 6,
    established: 1979,
    rating: 4.6,
    reviews: 29,
    lat: 46.235,
    lon: -112.107,
    accent: "#43506B",
    sky: "#C7D2E3",
    tags: ["Self Care", "Mountain Trails", "Large Acreage"],
    turnout: "Unlimited — 200 acres of open range grazing",
    arena: "None; natural terrain conditioning only",
    trails: "Direct trailhead into the Elkhorn range",
    tagline: "Self-care boarding on 200 acres of open range.",
    story:
      "North Star is bare-bones by design. You feed, you muck, you manage your own horse's care, and in exchange you get more acreage than most boarders will ever use. The Hollis family has run cattle and boarded horses on this land since the late seventies.",
    amenities: ["Heated tack room", "Community hay barn", "Equipment shed access", "Well water year-round"],
  },
  {
    id: "briar-hollow",
    name: "Briar Hollow Boarding",
    keeper: "Neil Fitzgerald",
    town: "Dunmore",
    state: "PA",
    price: 480,
    board: "Stall + Turnout",
    stalls: 4,
    established: 2004,
    rating: 4.5,
    reviews: 53,
    lat: 41.420,
    lon: -75.632,
    accent: "#6B4C6E",
    sky: "#C9B7CE",
    tags: ["Beginner Friendly", "Lesson Program", "Indoor Arena"],
    turnout: "Daily turnout, paired paddocks by temperament",
    arena: "70x150 indoor, used for lessons weekday evenings",
    trails: "Wooded loop trail on the property, 2 miles",
    tagline: "Family-run barn with a strong beginner lesson program.",
    story:
      "Briar Hollow built its name on patience — Neil started the lesson program to give his own kids something to do after school, and it grew from there. Boarders share space with a steady rotation of lesson horses, so the barn stays social and busy without ever feeling chaotic.",
    amenities: ["Mounting block ramp", "Kids' pony corner", "Tack swap shelf", "Birthday party hosting", "Heated lounge"],
  },
  {
    id: "iron-gate",
    name: "Iron Gate Sporthorses",
    keeper: "Élodie Bertrand",
    town: "Millbrook",
    state: "NY",
    price: 1050,
    board: "Full Care",
    stalls: 2,
    established: 2019,
    rating: 5.0,
    reviews: 18,
    lat: 41.786,
    lon: -73.687,
    accent: "#2E2E33",
    sky: "#9AA0AE",
    tags: ["Elite Program", "Import Sales", "Indoor Arena"],
    turnout: "Solo paddocks, 4 hrs, blanket-monitored",
    arena: "GGT footing indoor + European-spec outdoor",
    trails: "None — competition focus",
    tagline: "High-performance dressage program, very limited spots.",
    story:
      "Iron Gate keeps only a handful of boarders alongside Élodie's sale and competition string. Every horse is on an individualized conditioning plan, and the footing, farrier schedule, and vet relationships are all built around FEI-level soundness.",
    amenities: ["Solarium", "Equine spa/cold hosing bay", "Private tack room per horse", "Weekly bodywork", "Competition grooming team"],
  },
  {
    id: "sunflower-field",
    name: "Sunflower Field Stables",
    keeper: "Barb and Tom Nowak",
    town: "Clearview",
    state: "IA",
    price: 375,
    board: "Pasture Board",
    stalls: 10,
    established: 1985,
    rating: 4.4,
    reviews: 37,
    lat: 42.031,
    lon: -93.632,
    accent: "#B08A2E",
    sky: "#F0D98C",
    tags: ["Budget Friendly", "Herd Living", "Retirees Welcome"],
    turnout: "24/7 open pasture, sorted by age and soundness",
    arena: "Flat mowed field for light riding",
    trails: "Gravel road riding, quiet township roads",
    tagline: "Easygoing retirement and light-use pasture board.",
    story:
      "Sunflower Field specializes in the horse who's earned a slower life — a lot of their boarders are retirees or horses in light work. Barb checks the herd twice daily and knows every horse's quirks by name. It's unglamorous and completely reliable.",
    amenities: ["Loafing sheds", "Senior feed program", "Weight tape monitoring", "Farrier coordination", "Trailer pad"],
  },
  {
    id: "founders-crossing",
    name: "Founders Crossing",
    keeper: "Jamal Whitfield",
    town: "Redbank",
    state: "TX",
    price: 560,
    board: "Full Care",
    stalls: 7,
    established: 2008,
    rating: 4.8,
    reviews: 76,
    lat: 29.726,
    lon: -99.072,
    accent: "#7A3B2E",
    sky: "#E3AE8C",
    tags: ["Team Roping", "Indoor Arena", "Trainer On-Site"],
    turnout: "Dry lot paddocks, 8 hrs, sandy footing",
    arena: "Covered roping arena + round pen",
    trails: "Ranch loop, 5 miles, gate access to neighboring land",
    tagline: "Working ranch barn built for roping and reining.",
    story:
      "Founders Crossing grew out of Jamal's own roping string and still runs like a working ranch barn — feed is by the ton, not the bag, and the arena is rarely empty before sundown. Boarders are welcome to jump into the Tuesday night roping practice.",
    amenities: ["Covered hot walker", "Roping practice access", "Trailer & rig parking", "Wash rack with hot water", "On-site feed store"],
  },
  {
    id: "pinecrest-hollow",
    name: "Pinecrest Hollow",
    keeper: "Owen Traske",
    town: "Camden",
    state: "ME",
    price: 710,
    board: "Full Care",
    stalls: 4,
    established: 2001,
    rating: 4.9,
    reviews: 34,
    lat: 44.2098,
    lon: -69.0647,
    accent: "#2F5233",
    sky: "#9FBFA0",
    tags: ["Coastal Trails", "Small Herd", "Trainer On-Site"],
    turnout: "Turned out 10+ hrs daily in cliffside paddocks, sea breeze year-round",
    arena: "60x120 outdoor ring — no indoor, barn closes a few weeks in deep-snow stretches",
    trails: "Coastal carriage trails through Camden Hills State Park, 15 miles",
    tagline: "A small, weathered barn on the rocky coast of Maine.",
    story:
      "Owen keeps just four horses at a time in a barn his grandfather built from reclaimed ship timber. There's no indoor arena — winters mean a few closed weeks — but the payoff is riding carriage-road trails with ocean views most boarders never get inland.",
    amenities: ["Heated tack room", "Hay delivered weekly", "Blanket changes twice daily", "Hoof-boot fitting on request", "Winter lay-up program"],
  },
  {
    id: "granite-ridge",
    name: "Granite Ridge Farm",
    keeper: "the Doucette family",
    town: "Conway",
    state: "NH",
    price: 395,
    board: "Self Care",
    stalls: 9,
    established: 1991,
    rating: 4.5,
    reviews: 21,
    lat: 43.9856,
    lon: -71.122,
    accent: "#5B6770",
    sky: "#B9C4CB",
    tags: ["Self Care", "Mountain Views", "Large Acreage"],
    turnout: "Unlimited turnout on 90 acres of hillside pasture",
    arena: "None; conditioning is hill work and trail",
    trails: "Borders the White Mountain National Forest trail system",
    tagline: "Self-care boarding in the shadow of the White Mountains.",
    story:
      "Granite Ridge is a working hay farm first, boarding barn second. The Doucettes cut and bale their own hay, sell you stall space and a run of pasture, and otherwise stay out of your way. Mountain views from every paddock.",
    amenities: ["Heated wash stall", "Community tack room", "Equipment shed access", "On-site hay for purchase", "Trailer parking"],
  },
  {
    id: "cranberry-hill",
    name: "Cranberry Hill Stables",
    keeper: "Diane Kowalczyk",
    town: "Barnstable",
    state: "MA",
    price: 780,
    board: "Stall + Turnout",
    stalls: 6,
    established: 2009,
    rating: 4.6,
    reviews: 58,
    lat: 41.7003,
    lon: -70.2995,
    accent: "#8C3B4A",
    sky: "#E0AFAE",
    tags: ["Beach Access", "Lesson Program", "Indoor Arena"],
    turnout: "Paired turnout, 5-6 hrs, sandy Cape Cod paddocks",
    arena: "60x130 indoor, small outdoor jump field",
    trails: "Cape Cod Rail Trail access, 3 miles to permitted beach riding",
    tagline: "Cape Cod boarding with a busy junior lesson program.",
    story:
      "Cranberry Hill runs a full lesson program alongside its boarders, so the barn stays lively with kids and school horses most afternoons. Beach rides need a permit and good timing with the tide, but Diane organizes a group ride most summer weekends.",
    amenities: ["Junior lesson program", "Summer beach ride outings", "Tack cubbies", "Fly sheet laundering", "Birthday party hosting"],
  },
  {
    id: "stone-wall",
    name: "Stone Wall Farm",
    keeper: "Helena Voss",
    town: "Litchfield",
    state: "CT",
    price: 920,
    board: "Full Care",
    stalls: 3,
    established: 2013,
    rating: 4.9,
    reviews: 47,
    lat: 41.7492,
    lon: -73.1887,
    accent: "#556B4A",
    sky: "#C7CDB8",
    tags: ["Dressage Focus", "Indoor Arena", "Trainer On-Site"],
    turnout: "Individual grass paddocks, 6 hrs, stone-wall lined",
    arena: "70x160 indoor with GGT footing, outdoor dressage court with mirrors",
    trails: "None — dedicated flatwork program",
    tagline: "A small, serious dressage program in Litchfield County.",
    story:
      "Helena trained through Grand Prix in Germany before opening Stone Wall on her family's old dairy farm. She takes on very few boarders and expects them in regular lessons — this isn't a drop-in-and-hack kind of barn.",
    amenities: ["Weekly lesson included", "Equine solarium", "Private tack room per horse", "Video review of rides", "Show coaching available"],
  },
  {
    id: "cedar-run",
    name: "Cedar Run Equestrian",
    keeper: "Frank DiSalvo",
    town: "Tewksbury",
    state: "NJ",
    price: 715,
    board: "Full Care",
    stalls: 4,
    established: 1997,
    rating: 4.7,
    reviews: 89,
    lat: 40.6501,
    lon: -74.8038,
    accent: "#6E4B2A",
    sky: "#D9C39A",
    tags: ["Hunter/Jumper", "Indoor Arena", "Show Prep"],
    turnout: "Individual paddocks, 6-8 hrs, run-in sheds",
    arena: "90x200 indoor with mirrors, outdoor hunter ring with course",
    trails: "Ken Lockwood Gorge trail access, 20-minute trailer ride",
    tagline: "Hunter/jumper program forty minutes from Manhattan.",
    story:
      "Cedar Run pulls a lot of its boarders from the city — Frank runs a Friday-evening lesson slot specifically for the after-work crowd. The show string travels most weekends April through October, and the barn empties out accordingly.",
    amenities: ["Full grooming service", "Show hauling available", "Clipper & braiding on request", "Heated lounge with wifi", "Weekly farrier on-site"],
  },
  {
    id: "chesapeake-bridle",
    name: "Chesapeake Bridle Club",
    keeper: "Roland Beecher",
    town: "Easton",
    state: "MD",
    price: 465,
    board: "Pasture Board",
    stalls: 12,
    established: 1988,
    rating: 4.4,
    reviews: 33,
    lat: 38.7748,
    lon: -76.0741,
    accent: "#35586B",
    sky: "#A8C4D1",
    tags: ["Waterfront Pasture", "Herd Living", "Budget Friendly"],
    turnout: "24/7 group pasture along tidal creek frontage",
    arena: "Flat outdoor field, no jumps set",
    trails: "Farm road loops, 4 miles along the water",
    tagline: "Waterfront pasture board on Maryland's Eastern Shore.",
    story:
      "Roland's family has farmed this stretch of the Eastern Shore for four generations, and horses share the property with a small cattle herd. It's an unfussy, low-cost operation — you get a lot of pasture and water views for the price.",
    amenities: ["Loafing sheds", "Community hay barn", "Weight tape monitoring", "Farrier coordination", "Trailer pad"],
  },
  {
    id: "blue-ridge-crossing",
    name: "Blue Ridge Crossing",
    keeper: "Camille Ashworth",
    town: "Middleburg",
    state: "VA",
    price: 980,
    board: "Full Care",
    stalls: 5,
    established: 2005,
    rating: 4.9,
    reviews: 71,
    lat: 38.9698,
    lon: -77.7286,
    accent: "#4C5B7A",
    sky: "#B7C2D6",
    tags: ["Fox Hunting", "Eventing", "Indoor Arena"],
    turnout: "Individual and paired paddocks, 6 hrs, post-and-rail fencing",
    arena: "100x200 indoor, cross-country schooling field with permanent fences",
    trails: "Direct access to Piedmont hunt territory",
    tagline: "Foxhunting and eventing barn in Virginia hunt country.",
    story:
      "Blue Ridge sits inside established hunt territory, and most boarders ride out with the local hunt through fall and winter. Camille also runs a serious eventing program, with a cross-country field built to Training-level spec.",
    amenities: ["Cross-country schooling field", "Foxhunting field trips", "Full grooming service", "Equine spa/cold hosing bay", "Trailer & rig parking"],
  },
  {
    id: "sandhills-run",
    name: "Sandhills Run",
    keeper: "Tobias Reyes",
    town: "Southern Pines",
    state: "NC",
    price: 650,
    board: "Full Care",
    stalls: 6,
    established: 2000,
    rating: 4.8,
    reviews: 66,
    lat: 35.1799,
    lon: -79.3947,
    accent: "#A0673D",
    sky: "#EAC9A0",
    tags: ["Sandy Footing", "Eventing", "Trainer On-Site"],
    turnout: "Individual sand-based paddocks, 6-8 hrs, low-impact footing",
    arena: "80x200 indoor, plus access to shared sandhills schooling fields",
    trails: "Adjoining nature preserve, 4,000+ acres",
    tagline: "Training barn in the heart of the Sandhills horse country.",
    story:
      "Southern Pines has been a winter training hub for a century, and Sandhills Run leans into that — the sandy native footing is famously easy on legs, and the barn empties into thousands of acres of preserved riding land right out the gate.",
    amenities: ["Equine treadmill", "Weekly bodywork available", "Show hauling available", "Heated wash stall", "Trail map & guided rides"],
  },
  {
    id: "live-oak",
    name: "Live Oak Farm",
    keeper: "the Averill family",
    town: "St. Simons Island",
    state: "GA",
    price: 430,
    board: "Pasture Board",
    stalls: 10,
    established: 1994,
    rating: 4.5,
    reviews: 27,
    lat: 31.1548,
    lon: -81.3898,
    accent: "#6B5B35",
    sky: "#D8CFA0",
    tags: ["Herd Living", "Shaded Pasture", "Budget Friendly"],
    turnout: "24/7 group pasture under live oak canopy",
    arena: "Small outdoor ring, mostly used for groundwork",
    trails: "Marsh-front trail loop, 2.5 miles",
    tagline: "Shaded, easygoing pasture board on the Georgia coast.",
    story:
      "Live Oak's pastures sit under a canopy of centuries-old live oaks draped in Spanish moss, real shade in the Georgia heat. It's a herd-living, low-intervention kind of place — horses here mostly just get to be horses.",
    amenities: ["Loafing sheds", "Fly spray station", "Farrier on rotation", "Self-serve tack shed", "Trailer parking"],
  },
  {
    id: "cypress-creek",
    name: "Cypress Creek Ranch",
    keeper: "Marisol Duarte",
    town: "Ocala",
    state: "FL",
    price: 705,
    board: "Full Care",
    stalls: 8,
    established: 2015,
    rating: 4.7,
    reviews: 92,
    lat: 29.1872,
    lon: -82.1401,
    accent: "#2D4A42",
    sky: "#9BC0B5",
    tags: ["Breeding Program", "Indoor Arena", "Trainer On-Site"],
    turnout: "Individual paddocks, 8 hrs, irrigated pasture",
    arena: "GGT footing indoor, outdoor derby field",
    trails: "Cross Florida Greenway access, 8 miles",
    tagline: "Full-service training barn in horse-capital Ocala.",
    story:
      "Cypress Creek runs alongside Marisol's small breeding operation, so boarders share the property with a rotating handful of broodmares and young stock. Year-round riding weather keeps the barn busy every month, not just show season.",
    amenities: ["Breeding program tours", "Equine treadmill", "Full grooming service", "On-site vet visits weekly", "Show hauling available"],
  },
];

const BOARD_TYPES = ["All types", "Full Care", "Pasture Board", "Self Care", "Stall + Turnout"];

// A short list of reference cities so "near me" still works if the browser
// blocks geolocation inside this preview — pick the closest one manually.
const REFERENCE_CITIES = [
  { name: "New York, NY", lat: 40.7128, lon: -74.006 },
  { name: "Boston, MA", lat: 42.3601, lon: -71.0589 },
  { name: "Philadelphia, PA", lat: 39.9526, lon: -75.1652 },
  { name: "Washington, DC", lat: 38.9072, lon: -77.0369 },
  { name: "Atlanta, GA", lat: 33.749, lon: -84.388 },
  { name: "Miami, FL", lat: 25.7617, lon: -80.1918 },
  { name: "Nashville, TN", lat: 36.1627, lon: -86.7816 },
  { name: "Charlotte, NC", lat: 35.2271, lon: -80.8431 },
  { name: "Chicago, IL", lat: 41.8781, lon: -87.6298 },
  { name: "Minneapolis, MN", lat: 44.9778, lon: -93.265 },
  { name: "Kansas City, MO", lat: 39.0997, lon: -94.5786 },
  { name: "Dallas, TX", lat: 32.7767, lon: -96.797 },
  { name: "Houston, TX", lat: 29.7604, lon: -95.3698 },
  { name: "Austin, TX", lat: 30.2672, lon: -97.7431 },
  { name: "Denver, CO", lat: 39.7392, lon: -104.9903 },
  { name: "Phoenix, AZ", lat: 33.4484, lon: -112.074 },
  { name: "Salt Lake City, UT", lat: 40.7608, lon: -111.891 },
  { name: "Seattle, WA", lat: 47.6062, lon: -122.3321 },
  { name: "Portland, OR", lat: 45.5051, lon: -122.675 },
  { name: "San Francisco, CA", lat: 37.7749, lon: -122.4194 },
  { name: "Los Angeles, CA", lat: 34.0522, lon: -118.2437 },
];

// Simplified continental-US outline (lon, lat), traced clockwise from Maine.
// Stylized for a hand-drawn ranch-map feel — extra detail along the East Coast
// (Cape Cod, Long Island Sound, Chesapeake Bay, the Outer Banks) since that's
// where most of the barns are. Not survey-accurate.
const US_OUTLINE = [
  [-67.0, 45.2], [-69.2, 44.4], [-70.0, 43.7], [-70.8, 42.3], [-70.7, 41.75],
  [-70.5, 41.7], [-70.05, 41.75], [-70.0, 42.05], [-70.25, 42.03], [-70.5, 41.85],
  [-70.7, 41.6], [-70.9, 41.55], [-71.1, 41.5], [-71.3, 41.65], [-71.4, 41.35],
  [-71.8, 41.3], [-72.6, 41.25], [-73.2, 41.0], [-73.7, 40.85], [-74.0, 40.7],
  [-74.05, 40.5], [-75.5, 39.7], [-76.1, 39.3], [-76.5, 38.98], [-76.3, 38.3],
  [-76.6, 37.6], [-76.3, 37.0], [-75.9, 36.2], [-75.6, 35.6], [-75.53, 35.25],
  [-75.9, 35.15], [-76.6, 34.6], [-77.4, 34.2], [-78.0, 33.9], [-80.9, 32.0],
  [-81.4, 30.3], [-81.3, 29.9], [-80.6, 28.4], [-80.2, 26.7], [-80.1, 25.2],
  [-81.7, 24.7], [-82.6, 27.8], [-82.9, 28.9], [-83.6, 29.55], [-84.5, 29.9],
  [-87.2, 30.3], [-89.4, 29.2], [-93.8, 29.7], [-97.2, 26.0], [-99.5, 27.5],
  [-104.9, 29.6], [-106.5, 31.8], [-108.2, 31.3], [-111.1, 31.3], [-114.7, 32.5],
  [-117.2, 32.6], [-118.4, 33.9], [-120.6, 34.5], [-121.9, 36.6], [-122.5, 37.8],
  [-123.9, 39.5], [-124.2, 42.0], [-124.7, 46.3], [-124.7, 48.4], [-122.8, 49.0],
  [-95.2, 49.0], [-94.8, 49.4], [-92.3, 46.8], [-87.9, 45.1], [-83.6, 43.6],
  [-82.4, 41.7], [-79.0, 42.9], [-76.2, 43.3], [-73.3, 45.0], [-71.5, 45.0],
  [-69.2, 47.5], [-67.0, 45.2],
];

// Separate landmasses drawn on top of the main outline.
const LONG_ISLAND = [
  [-73.95, 40.75], [-73.5, 40.9], [-73.0, 40.95], [-72.4, 41.0], [-71.95, 41.08],
  [-71.86, 41.07], [-72.0, 40.95], [-72.7, 40.85], [-73.3, 40.75], [-73.95, 40.6],
  [-74.0, 40.65], [-73.95, 40.75],
];

const DELMARVA = [
  [-75.5, 39.7], [-75.3, 39.5], [-75.15, 39.0], [-75.3, 38.4], [-75.6, 38.0],
  [-75.9, 37.4], [-76.0, 37.0], [-76.2, 37.2], [-76.05, 37.9], [-75.9, 38.5],
  [-75.8, 39.1], [-75.7, 39.5], [-75.5, 39.7],
];

// A rough Appalachian ridge line, used only as a light decorative texture.
const APPALACHIAN_RIDGE = [
  [-84.3, 34.6], [-83.6, 35.5], [-82.6, 36.1], [-81.6, 36.6], [-80.5, 37.4],
  [-79.8, 38.4], [-78.9, 39.3], [-78.2, 40.2], [-77.5, 41.0], [-76.6, 41.7],
  [-75.5, 42.3], [-74.4, 43.2], [-73.2, 44.0], [-71.5, 44.3], [-70.3, 45.0],
];

// Approximate internal state borders, focused on the East Coast (where the
// barns are) plus rough boxes for the handful of interior states with a
// listing. Hand-traced for a "ranch office wall map" feel — subtle by
// design, not survey-accurate.
// Real, simplified continental-US state boundaries (Douglas-Peucker
// simplified from Census-derived cartographic boundaries) — drawn as solid
// closed outlines on top of the base map.
const STATE_POLYGONS = [
  [[-87.36,35.00],[-85.61,34.98],[-85.18,32.86],[-84.89,32.26],[-85.14,31.84],[-85.00,31.00],[-87.60,31.00],[-87.37,30.43],[-87.66,30.25],[-88.01,30.69],[-88.14,30.32],[-88.39,30.37],[-88.47,31.90],[-88.20,35.00],[-87.36,35.00]], // Alabama
  [[-109.04,37.00],[-109.05,31.33],[-111.07,31.33],[-114.82,32.49],[-114.47,32.84],[-114.73,33.41],[-114.52,33.55],[-114.54,33.93],[-114.14,34.31],[-114.63,34.88],[-114.74,36.10],[-114.15,36.03],[-114.05,37.00],[-109.04,37.00]], // Arizona
  [[-94.47,36.50],[-90.15,36.50],[-90.06,36.30],[-90.38,36.00],[-89.73,36.00],[-89.76,35.81],[-90.13,35.44],[-90.57,34.42],[-90.95,34.14],[-91.23,33.56],[-91.06,33.43],[-91.17,33.00],[-94.04,33.02],[-94.04,33.55],[-94.48,33.64],[-94.43,35.40],[-94.62,36.50],[-94.47,36.50]], // Arkansas
  [[-123.23,42.01],[-120.00,42.00],[-120.00,39.00],[-114.63,35.00],[-114.14,34.31],[-114.54,33.93],[-114.52,33.55],[-114.73,33.41],[-114.52,32.76],[-117.13,32.54],[-117.47,33.30],[-118.41,33.74],[-118.57,34.04],[-120.65,34.58],[-120.63,35.10],[-121.90,36.32],[-121.79,36.80],[-121.93,36.98],[-122.42,37.24],[-122.41,38.15],[-122.50,37.93],[-122.94,38.03],[-123.13,38.45],[-123.74,38.96],[-123.85,39.83],[-124.36,40.26],[-124.07,41.44],[-124.21,42.00],[-123.23,42.01]], // California
  [[-107.92,41.00],[-102.05,41.00],[-102.04,36.99],[-109.04,37.00],[-109.05,41.00],[-107.92,41.00]], // Colorado
  [[-73.05,42.04],[-71.80,42.02],[-71.80,41.41],[-73.66,40.99],[-73.73,41.10],[-73.48,41.21],[-73.49,42.05],[-73.05,42.04]], // Connecticut
  [[-75.41,39.80],[-75.59,39.46],[-75.09,38.80],[-75.05,38.45],[-75.69,38.46],[-75.79,39.72],[-75.41,39.80]], // Delaware
  [[-77.04,38.99],[-76.91,38.90],[-77.04,38.79],[-77.04,38.99]], // District of Columbia
  [[-85.50,31.00],[-85.00,31.00],[-84.87,30.71],[-82.22,30.57],[-82.17,30.36],[-81.95,30.83],[-81.44,30.71],[-81.26,29.79],[-80.52,28.46],[-80.57,28.09],[-80.03,26.80],[-80.15,25.74],[-80.50,25.20],[-81.08,25.12],[-81.35,25.82],[-81.68,25.84],[-82.06,26.88],[-82.25,26.76],[-82.69,27.44],[-82.39,27.84],[-82.72,27.69],[-82.85,27.89],[-82.64,28.89],[-83.64,29.89],[-84.02,30.10],[-85.31,29.70],[-85.40,29.94],[-86.30,30.36],[-87.52,30.28],[-87.37,30.43],[-87.60,31.00],[-85.50,31.00]], // Florida
  [[-83.11,35.00],[-83.34,34.68],[-82.90,34.49],[-82.56,33.94],[-81.49,33.01],[-81.12,32.12],[-80.89,32.03],[-81.40,31.13],[-81.44,30.71],[-81.95,30.83],[-82.05,30.36],[-82.22,30.57],[-84.87,30.71],[-85.11,31.28],[-85.14,31.84],[-84.89,32.26],[-85.18,32.86],[-85.61,34.98],[-83.11,35.00]], // Georgia
  [[-116.05,49.00],[-116.05,47.98],[-115.72,47.70],[-115.72,47.42],[-114.61,46.64],[-114.32,46.65],[-114.55,45.56],[-113.81,45.60],[-113.46,44.87],[-113.13,44.77],[-112.89,44.39],[-111.62,44.55],[-111.39,44.76],[-111.05,44.48],[-111.05,42.00],[-117.03,42.00],[-116.90,44.16],[-117.24,44.39],[-116.46,45.62],[-117.06,46.34],[-117.03,49.00],[-116.05,49.00]], // Idaho
  [[-90.64,42.51],[-87.80,42.49],[-87.52,41.71],[-87.64,39.17],[-87.50,38.78],[-87.95,38.28],[-88.07,37.48],[-88.48,37.39],[-88.55,37.07],[-89.03,37.21],[-89.29,36.99],[-89.52,37.28],[-89.52,37.69],[-90.36,38.22],[-90.11,38.85],[-90.66,38.93],[-90.73,39.26],[-91.37,39.73],[-91.49,40.03],[-91.40,40.56],[-90.96,40.92],[-91.05,41.41],[-90.34,41.59],[-90.18,41.81],[-90.17,42.13],[-90.64,42.51]], // Illinois
  [[-85.99,41.76],[-84.81,41.76],[-84.81,38.79],[-85.43,38.73],[-85.42,38.53],[-86.04,37.96],[-86.30,38.17],[-86.50,37.93],[-86.80,37.99],[-87.13,37.79],[-87.60,37.98],[-88.03,37.80],[-87.95,38.28],[-87.50,38.78],[-87.64,39.17],[-87.52,41.71],[-85.99,41.76]], // Indiana
  [[-91.37,43.50],[-91.06,43.25],[-91.07,42.75],[-90.71,42.64],[-90.14,42.00],[-90.34,41.59],[-91.05,41.41],[-90.96,40.92],[-91.42,40.38],[-91.73,40.62],[-95.77,40.59],[-96.13,41.97],[-96.63,42.71],[-96.43,43.12],[-96.58,43.48],[-96.45,43.50],[-91.37,43.50]], // Iowa
  [[-101.91,40.00],[-95.31,40.00],[-94.88,39.83],[-95.11,39.54],[-94.61,39.16],[-94.62,37.00],[-102.04,36.99],[-102.05,40.00],[-101.91,40.00]], // Kansas
  [[-83.90,38.77],[-83.68,38.63],[-82.89,38.76],[-82.59,38.42],[-82.50,37.93],[-81.97,37.54],[-83.14,36.74],[-83.69,36.58],[-88.07,36.68],[-88.05,36.50],[-89.42,36.50],[-89.22,36.58],[-89.03,37.21],[-88.55,37.07],[-88.48,37.39],[-88.07,37.48],[-88.16,37.66],[-87.93,37.89],[-87.60,37.98],[-87.13,37.79],[-86.80,37.99],[-86.50,37.93],[-86.30,38.17],[-86.04,37.96],[-85.42,38.53],[-85.43,38.73],[-84.81,38.79],[-84.82,39.10],[-84.43,39.10],[-84.22,38.81],[-83.90,38.77]], // Kentucky
  [[-93.61,33.02],[-91.17,33.00],[-90.99,32.22],[-91.50,31.64],[-91.64,31.00],[-89.75,31.00],[-89.85,30.67],[-89.52,30.18],[-89.84,29.95],[-89.60,29.88],[-89.50,30.04],[-89.29,29.88],[-89.42,29.70],[-89.65,29.75],[-89.70,29.51],[-89.00,29.18],[-89.34,29.04],[-89.85,29.31],[-89.85,29.48],[-90.10,29.15],[-90.56,29.28],[-90.80,29.09],[-91.89,29.84],[-92.31,29.54],[-93.23,29.78],[-93.84,29.69],[-93.53,30.94],[-94.04,31.99],[-94.04,33.02],[-93.61,33.02]], // Louisiana
  [[-70.70,43.06],[-70.97,43.34],[-71.08,45.30],[-70.39,45.74],[-70.00,46.69],[-69.23,47.46],[-68.90,47.18],[-68.23,47.36],[-67.95,47.20],[-67.79,47.07],[-67.80,45.68],[-67.46,45.60],[-67.49,45.28],[-67.16,45.16],[-66.98,44.80],[-68.05,44.33],[-68.22,44.49],[-68.17,44.33],[-68.40,44.25],[-68.98,44.43],[-69.07,44.04],[-69.83,43.72],[-70.03,43.85],[-70.70,43.06]], // Maine
  [[-79.48,39.72],[-75.79,39.72],[-75.69,38.46],[-75.05,38.45],[-75.24,38.03],[-75.89,37.91],[-75.85,38.21],[-76.26,38.32],[-76.28,39.15],[-75.97,39.56],[-76.37,39.31],[-76.56,38.77],[-76.36,38.06],[-77.02,38.45],[-77.21,38.36],[-77.28,38.48],[-76.91,38.90],[-77.46,39.08],[-77.83,39.60],[-78.77,39.59],[-79.49,39.21],[-79.48,39.72]], // Maryland
  [[-70.92,42.89],[-70.78,42.70],[-70.99,42.27],[-70.77,42.25],[-70.54,41.81],[-69.94,41.81],[-70.01,41.67],[-71.12,41.50],[-71.38,42.02],[-73.51,42.09],[-73.27,42.75],[-71.30,42.70],[-70.92,42.89]], // Massachusetts
  [[-92.01,46.71],[-92.29,46.67],[-92.29,46.08],[-92.87,45.72],[-92.64,45.44],[-92.81,44.75],[-91.43,43.99],[-91.22,43.50],[-96.45,43.50],[-96.45,45.30],[-96.86,45.60],[-96.58,45.82],[-96.60,46.33],[-96.80,46.66],[-97.23,49.00],[-95.15,49.00],[-95.15,49.38],[-94.96,49.37],[-94.59,48.72],[-93.79,48.52],[-92.98,48.62],[-92.37,48.22],[-92.05,48.36],[-91.57,48.04],[-90.84,48.24],[-90.75,48.09],[-89.62,48.01],[-90.74,47.63],[-92.01,46.71]], // Minnesota
  [[-88.47,35.00],[-88.10,34.89],[-88.47,31.90],[-88.39,30.37],[-89.52,30.18],[-89.85,30.67],[-89.75,31.00],[-91.64,31.00],[-91.50,31.64],[-90.99,32.22],[-91.15,32.64],[-91.06,33.43],[-91.23,33.56],[-90.31,35.00],[-88.47,35.00]], // Mississippi
  [[-87.59,45.10],[-87.74,45.20],[-87.65,45.34],[-87.89,45.36],[-87.78,45.68],[-88.10,45.92],[-90.12,46.34],[-90.42,46.57],[-89.00,47.00],[-88.18,47.46],[-87.96,47.38],[-88.44,46.97],[-88.44,46.79],[-87.90,46.91],[-87.39,46.54],[-86.70,46.44],[-86.16,46.67],[-85.06,46.76],[-85.03,46.48],[-84.13,46.53],[-83.99,46.03],[-83.48,45.99],[-84.66,46.05],[-84.70,45.85],[-85.50,46.10],[-86.66,45.70],[-86.78,45.86],[-87.17,45.66],[-87.59,45.10]], // Michigan
  [[-91.83,40.61],[-91.42,40.38],[-91.37,39.73],[-90.73,39.26],[-90.66,38.93],[-90.11,38.85],[-90.36,38.22],[-89.52,37.69],[-89.52,37.28],[-89.13,36.98],[-89.22,36.58],[-89.54,36.50],[-89.73,36.00],[-90.38,36.00],[-90.06,36.30],[-90.15,36.50],[-94.62,36.50],[-94.61,39.16],[-95.11,39.54],[-94.88,39.83],[-95.21,39.91],[-95.77,40.59],[-91.83,40.61]], // Missouri
  [[-104.05,49.00],[-104.04,45.00],[-111.05,45.00],[-111.05,44.48],[-111.39,44.76],[-111.62,44.55],[-112.89,44.39],[-113.13,44.77],[-113.46,44.87],[-113.81,45.60],[-114.55,45.56],[-114.32,46.65],[-114.61,46.64],[-115.72,47.42],[-115.72,47.70],[-116.05,47.98],[-116.05,49.00],[-104.05,49.00]], // Montana
  [[-103.32,43.00],[-98.50,43.00],[-97.95,42.77],[-97.22,42.84],[-96.69,42.66],[-96.13,41.97],[-95.88,40.72],[-95.31,40.00],[-102.05,40.00],[-102.05,41.00],[-104.05,41.00],[-104.05,43.00],[-103.32,43.00]], // Nebraska
  [[-117.03,42.00],[-114.04,42.00],[-114.05,36.20],[-114.15,36.03],[-114.74,36.10],[-114.63,35.00],[-120.00,39.00],[-120.00,42.00],[-117.03,42.00]], // Nevada
  [[-71.08,45.30],[-70.97,43.34],[-70.70,43.06],[-71.30,42.70],[-72.46,42.73],[-72.38,43.57],[-72.03,44.32],[-71.54,44.59],[-71.63,44.75],[-71.36,45.27],[-71.08,45.30]], // New Hampshire
  [[-74.24,41.14],[-73.90,41.00],[-74.27,40.49],[-74.00,40.41],[-74.10,39.76],[-74.80,38.99],[-75.56,39.63],[-74.77,40.22],[-75.20,40.58],[-75.13,40.97],[-74.70,41.36],[-74.24,41.14]], // New Jersey
  [[-107.42,37.00],[-103.00,37.00],[-103.07,32.00],[-106.62,32.00],[-106.53,31.79],[-108.21,31.79],[-108.21,31.33],[-109.05,31.33],[-109.04,37.00],[-107.42,37.00]], // New Mexico
  [[-73.34,45.01],[-73.44,44.04],[-73.25,43.52],[-73.27,42.75],[-73.51,42.09],[-73.48,41.21],[-73.73,41.10],[-73.23,40.91],[-72.28,41.16],[-72.10,40.99],[-73.94,40.54],[-73.90,41.00],[-74.89,41.44],[-75.36,42.00],[-79.76,42.00],[-79.76,42.27],[-78.85,42.78],[-79.07,43.26],[-76.70,43.34],[-76.24,43.53],[-76.14,43.96],[-76.31,44.20],[-75.28,44.85],[-74.83,45.02],[-73.34,45.01]], // New York
  [[-80.98,36.56],[-75.87,36.55],[-75.75,36.15],[-76.67,35.94],[-75.78,35.94],[-75.72,35.70],[-76.15,35.32],[-76.48,35.31],[-76.54,35.14],[-76.28,34.94],[-76.49,34.66],[-77.21,34.61],[-77.83,34.16],[-77.97,33.85],[-78.54,33.85],[-79.68,34.80],[-80.80,34.82],[-81.04,35.15],[-84.32,34.99],[-84.29,35.23],[-83.77,35.56],[-82.99,35.77],[-82.64,36.06],[-82.04,36.12],[-81.68,36.59],[-80.98,36.56]], // North Carolina
  [[-97.23,49.00],[-96.56,45.93],[-104.05,45.94],[-104.05,49.00],[-97.23,49.00]], // North Dakota
  [[-80.52,41.98],[-80.52,40.64],[-80.67,40.58],[-80.83,39.71],[-81.69,39.27],[-81.89,38.87],[-82.04,39.03],[-82.33,38.45],[-82.59,38.42],[-82.89,38.76],[-83.68,38.63],[-84.22,38.81],[-84.43,39.10],[-84.82,39.10],[-84.81,41.69],[-83.45,41.73],[-82.48,41.38],[-80.52,41.98]], // Ohio
  [[-100.09,37.00],[-94.62,37.00],[-94.43,35.40],[-94.48,33.64],[-95.22,33.96],[-96.35,33.69],[-96.92,33.96],[-97.17,33.74],[-97.69,33.98],[-97.87,33.85],[-98.17,34.11],[-99.19,34.21],[-99.26,34.40],[-99.70,34.38],[-100.00,34.56],[-100.00,36.50],[-103.00,36.50],[-103.00,37.00],[-100.09,37.00]], // Oklahoma
  [[-123.21,46.17],[-122.90,46.08],[-122.76,45.66],[-122.25,45.55],[-118.99,46.00],[-116.92,45.99],[-116.55,45.75],[-116.46,45.62],[-117.24,44.39],[-116.90,44.16],[-117.03,42.00],[-124.21,42.00],[-124.55,42.84],[-124.17,43.81],[-123.99,45.94],[-123.55,46.26],[-123.21,46.17]], // Oregon
  [[-79.76,42.25],[-79.76,42.00],[-75.36,42.00],[-74.70,41.36],[-75.21,40.69],[-74.77,40.22],[-75.15,39.89],[-75.79,39.72],[-80.52,39.72],[-80.52,41.98],[-79.76,42.25]], // Pennsylvania
  [[-71.53,42.02],[-71.22,41.71],[-71.48,41.37],[-71.86,41.32],[-71.80,42.01],[-71.53,42.02]], // Rhode Island
  [[-82.76,35.07],[-81.04,35.15],[-80.80,34.82],[-79.68,34.80],[-78.54,33.85],[-78.94,33.64],[-79.36,33.01],[-79.58,33.01],[-80.89,32.03],[-81.12,32.12],[-81.49,33.01],[-82.56,33.94],[-82.90,34.49],[-83.34,34.68],[-83.11,35.00],[-82.76,35.07]], // South Carolina
  [[-104.05,45.94],[-96.56,45.93],[-96.86,45.60],[-96.45,45.30],[-96.45,43.50],[-96.58,43.48],[-96.43,43.12],[-96.63,42.71],[-96.45,42.49],[-97.22,42.84],[-97.95,42.77],[-98.50,43.00],[-104.05,43.00],[-104.05,45.94]], // South Dakota
  [[-88.05,36.50],[-88.07,36.68],[-81.68,36.59],[-82.04,36.12],[-82.64,36.06],[-82.99,35.77],[-83.77,35.56],[-84.29,35.23],[-84.32,34.99],[-90.31,35.00],[-89.54,36.50],[-88.05,36.50]], // Tennessee
  [[-101.81,36.50],[-100.00,36.50],[-100.00,34.56],[-99.70,34.38],[-99.26,34.40],[-99.19,34.21],[-98.17,34.11],[-97.87,33.85],[-97.69,33.98],[-97.17,33.74],[-96.92,33.96],[-96.35,33.69],[-95.22,33.96],[-94.04,33.55],[-94.04,31.99],[-93.53,30.94],[-93.84,29.69],[-94.52,29.55],[-94.74,29.79],[-95.02,29.56],[-94.90,29.31],[-95.38,28.87],[-95.99,28.60],[-96.66,28.70],[-96.40,28.44],[-96.77,28.41],[-97.54,27.23],[-97.22,25.99],[-97.52,25.89],[-98.20,26.06],[-99.17,26.54],[-99.48,27.48],[-100.30,28.28],[-100.67,29.10],[-101.41,29.75],[-102.34,29.87],[-103.28,28.98],[-104.51,29.64],[-104.90,30.57],[-106.64,31.90],[-103.07,32.00],[-103.04,36.50],[-101.81,36.50]], // Texas
  [[-112.16,42.00],[-111.05,42.00],[-111.05,41.00],[-109.05,41.00],[-109.04,37.00],[-114.05,37.00],[-114.04,42.00],[-112.16,42.00]], // Utah
  [[-71.50,45.01],[-71.54,44.59],[-72.03,44.32],[-72.38,43.57],[-72.46,42.73],[-73.27,42.75],[-73.25,43.52],[-73.44,44.04],[-73.34,45.01],[-71.50,45.01]], // Vermont
  [[-78.35,39.46],[-77.83,39.13],[-77.57,39.31],[-77.12,38.93],[-77.28,38.34],[-77.01,38.37],[-76.24,37.89],[-76.40,37.16],[-76.27,37.08],[-76.67,37.07],[-75.99,36.92],[-75.87,36.55],[-83.67,36.60],[-83.14,36.74],[-81.97,37.54],[-81.68,37.20],[-80.30,37.51],[-79.65,38.59],[-79.31,38.41],[-79.00,38.85],[-78.87,38.76],[-78.40,39.17],[-78.35,39.46]], // Virginia
  [[-117.03,49.00],[-117.06,46.34],[-116.92,45.99],[-118.99,46.00],[-121.18,45.60],[-122.76,45.66],[-122.90,46.08],[-124.07,46.33],[-123.90,46.54],[-124.71,48.18],[-124.60,48.38],[-122.80,48.09],[-122.52,47.88],[-122.42,47.32],[-122.23,48.03],[-122.76,49.00],[-117.03,49.00]], // Washington
  [[-80.52,40.64],[-80.52,39.72],[-79.48,39.72],[-79.49,39.21],[-78.17,39.69],[-77.83,39.60],[-77.72,39.32],[-77.83,39.13],[-78.35,39.46],[-78.40,39.17],[-78.87,38.76],[-79.00,38.85],[-79.31,38.41],[-79.65,38.59],[-80.30,37.51],[-81.68,37.20],[-82.50,37.93],[-82.59,38.42],[-82.33,38.45],[-82.04,39.03],[-81.89,38.87],[-81.69,39.27],[-80.83,39.71],[-80.67,40.58],[-80.52,40.64]], // West Virginia
  [[-90.42,46.57],[-90.12,46.34],[-88.10,45.92],[-87.78,45.68],[-87.89,45.36],[-87.65,45.34],[-87.74,45.20],[-87.59,45.10],[-88.04,44.56],[-87.03,45.22],[-87.74,43.88],[-87.91,43.25],[-87.80,42.49],[-90.64,42.51],[-91.07,42.75],[-91.06,43.25],[-91.43,43.99],[-92.81,44.75],[-92.64,45.44],[-92.87,45.72],[-92.29,46.08],[-92.29,46.67],[-90.84,46.96],[-90.89,46.75],[-90.42,46.57]], // Wisconsin
  [[-109.08,45.00],[-104.06,45.00],[-104.05,41.00],[-111.05,41.00],[-111.05,45.00],[-109.08,45.00]], // Wyoming
];

const MAP_W = 600;
const MAP_H = 255;
const LON_MIN = -125, LON_MAX = -66, LAT_MIN = 24, LAT_MAX = 49.5;

function project([lon, lat]) {
  const x = ((lon - LON_MIN) / (LON_MAX - LON_MIN)) * MAP_W;
  const y = ((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * MAP_H;
  return [x, y];
}

function pathFromLonLat(points) {
  return "M " + points.map((p) => project(p).map((n) => n.toFixed(1)).join(",")).join(" L ") + " Z";
}

function distanceMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* -------------------------------- BARN SCENE ------------------------------- */

function BarnScene({ barn, tall }) {
  const gid = `sky-${barn.id}`;
  return (
    <svg viewBox="0 0 400 220" className="w-full h-full" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={barn.sky} />
          <stop offset="100%" stopColor="#F3ECD8" />
        </linearGradient>
      </defs>
      <rect width="400" height="220" fill={`url(#${gid})`} />
      <circle cx="335" cy="45" r="22" fill="#F6EFDD" opacity="0.85" />
      <path d="M0 160 Q100 130 200 155 T400 145 V220 H0 Z" fill={barn.accent} opacity="0.25" />
      <path d="M0 180 Q120 155 240 178 T400 168 V220 H0 Z" fill={barn.accent} opacity="0.4" />
      {/* fence */}
      <g opacity="0.55" stroke={barn.accent} strokeWidth="3">
        {[10, 45, 80, 115, 150, 185, 220, 255, 290, 325, 360, 395].map((x) => (
          <line key={x} x1={x} y1="190" x2={x} y2="212" />
        ))}
        <line x1="0" y1="196" x2="400" y2="196" />
        <line x1="0" y1="206" x2="400" y2="206" />
      </g>
      {/* barn */}
      <g transform="translate(150,95)">
        <polygon points="0,45 45,0 90,45" fill={barn.accent} />
        <rect x="6" y="45" width="78" height="60" fill={barn.accent} />
        <rect x="34" y="70" width="22" height="35" fill="#F3ECD8" opacity="0.9" />
        <polygon points="6,45 84,45 84,52 6,52" fill="#F3ECD8" opacity="0.35" />
        <circle cx="45" cy="24" r="6" fill="#F3ECD8" opacity="0.7" />
      </g>
      {/* silo */}
      <g transform="translate(255,60)">
        <rect x="0" y="20" width="22" height="65" fill={barn.accent} opacity="0.85" />
        <ellipse cx="11" cy="20" rx="11" ry="7" fill={barn.accent} />
      </g>
      {/* tree */}
      <g transform="translate(60,120)">
        <rect x="9" y="20" width="5" height="20" fill={barn.accent} opacity="0.7" />
        <circle cx="11" cy="12" r="16" fill={barn.accent} opacity="0.55" />
      </g>
    </svg>
  );
}

/* --------------------------- GALLERY SCENES (illustrated) -------------------
   These are original stylized illustrations standing in for "photos" — not
   real photography — so every barn gets a believable gallery without using
   anyone else's images. */

function HorseSilhouette({ x = 0, y = 0, scale = 1, color = "#2A2013", flip = false, headDown = false }) {
  const sx = flip ? -scale : scale;
  return (
    <g transform={`translate(${x},${y}) scale(${sx},${scale})`} fill={color}>
      <ellipse cx="0" cy="0" rx="15" ry="8.5" />
      <rect x="-11" y="5" width="3" height="13" rx="1.3" />
      <rect x="-4" y="6" width="3" height="13" rx="1.3" />
      <rect x="4" y="6" width="3" height="13" rx="1.3" />
      <rect x="10" y="5" width="3" height="13" rx="1.3" />
      {headDown ? (
        <polygon points="11,-4 20,3 23,11 17,14 9,3" />
      ) : (
        <polygon points="11,-5 19,-13 24,-22 21,-24 13,-13 8,-5" />
      )}
      <polygon points="-15,-3 -23,2 -19,12" />
    </g>
  );
}

function PastureScene({ barn }) {
  const sky = `pasture-sky-${barn.id}`;
  const ground = `pasture-ground-${barn.id}`;
  return (
    <svg viewBox="0 0 400 220" className="w-full h-full" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id={sky} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={barn.sky} />
          <stop offset="55%" stopColor="#F3D9A6" />
          <stop offset="100%" stopColor="#EFE0BE" />
        </linearGradient>
        <linearGradient id={ground} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={barn.accent} stopOpacity="0.5" />
          <stop offset="100%" stopColor={barn.accent} stopOpacity="0.85" />
        </linearGradient>
      </defs>
      <rect width="400" height="220" fill={`url(#${sky})`} />
      <circle cx="65" cy="55" r="24" fill="#FCEBC2" opacity="0.8" />
      <path d="M0,150 Q100,120 200,145 T400,135 V220 H0 Z" fill={`url(#${ground})`} />
      <g stroke={barn.accent} strokeWidth="2.5" opacity="0.6">
        <line x1="0" y1="168" x2="400" y2="160" />
        <line x1="0" y1="178" x2="400" y2="170" />
        {[20, 80, 140, 200, 260, 320, 380].map((x, i) => (
          <line key={i} x1={x} y1="150" x2={x - 3} y2="184" />
        ))}
      </g>
      <HorseSilhouette x={150} y={185} scale={1.5} color={barn.accent} headDown />
      <HorseSilhouette x={235} y={196} scale={1.1} color={barn.accent} flip />
      <HorseSilhouette x={305} y={180} scale={0.85} color={barn.accent} headDown flip />
    </svg>
  );
}

function ArenaScene({ barn }) {
  const bg = `arena-${barn.id}`;
  return (
    <svg viewBox="0 0 400 220" className="w-full h-full" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id={bg} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#EDE4D0" />
          <stop offset="100%" stopColor="#D8C9A3" />
        </linearGradient>
      </defs>
      <rect width="400" height="220" fill={`url(#${bg})`} />
      <rect x="0" y="30" width="400" height="55" fill={barn.accent} opacity="0.75" />
      <rect x="0" y="80" width="400" height="6" fill={barn.accent} opacity="0.9" />
      {[40, 120, 200, 280, 360].map((x, i) => (
        <line key={i} x1={x} y1="30" x2={x} y2="85" stroke="#2A2013" strokeOpacity="0.15" strokeWidth="3" />
      ))}
      <path d="M0,150 L120,120 L280,120 L400,150" fill="none" stroke={barn.accent} strokeWidth="4" opacity="0.7" />
      <path d="M0,168 L110,140 L290,140 L400,168" fill="none" stroke={barn.accent} strokeWidth="4" opacity="0.7" />
      <rect x="0" y="150" width="400" height="70" fill="#E4CE9E" opacity="0.9" />
      {Array.from({ length: 50 }).map((_, i) => (
        <circle key={i} cx={(i * 41) % 400} cy={158 + ((i * 53) % 55)} r="0.8" fill="#B79A5E" opacity="0.4" />
      ))}
      <HorseSilhouette x={205} y={186} scale={1.5} color="#2A2013" />
    </svg>
  );
}

function DetailScene({ barn }) {
  const plank = `plank-${barn.id}`;
  return (
    <svg viewBox="0 0 400 220" className="w-full h-full" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id={plank} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={barn.accent} stopOpacity="0.35" />
          <stop offset="100%" stopColor="#3A2E1E" stopOpacity="0.55" />
        </linearGradient>
      </defs>
      <rect width="400" height="220" fill="#EFE6D3" />
      <rect width="400" height="220" fill={`url(#${plank})`} />
      {[45, 95, 145, 195, 245, 295, 345].map((x, i) => (
        <line key={i} x1={x} y1="0" x2={x} y2="220" stroke="#2A2013" strokeOpacity="0.18" strokeWidth="2" />
      ))}
      <circle cx="150" cy="45" r="3" fill="#2A2013" opacity="0.6" />
      <path d="M120,140 A45,45 0 1 1 210,140" fill="none" stroke="#D7B679" strokeWidth="10" strokeLinecap="round" />
      <circle cx="125" cy="140" r="3" fill="#8f6a37" />
      <circle cx="205" cy="140" r="3" fill="#8f6a37" />
      <line x1="165" y1="46" x2="165" y2="95" stroke="#8f6a37" strokeWidth="2" opacity="0.7" />
      <g transform="translate(300,150)" fill="none" stroke="#B78A4A" strokeWidth="5" strokeLinecap="round">
        <circle r="28" opacity="0.9" />
        <circle r="20" opacity="0.7" />
        <circle r="12" opacity="0.5" />
      </g>
      <g stroke="#D7B679" strokeWidth="1.5" opacity="0.55">
        {Array.from({ length: 16 }).map((_, i) => (
          <line key={i} x1={i * 26} y1="220" x2={i * 26 + 9 - (i % 3) * 6} y2="196" />
        ))}
      </g>
    </svg>
  );
}

const GALLERY = [
  { type: "exterior", label: "Barn & grounds" },
  { type: "pasture", label: "Turnout pasture" },
  { type: "arena", label: "Arena & riding" },
  { type: "detail", label: "Tack corner" },
];

function GalleryScene({ type, barn }) {
  // If a barn has a real photo URL for this slot (barn.photos[type]), use it —
  // with a fallback to the illustration if the image fails to load (broken
  // link, blocked hotlinking, etc). Otherwise, show the illustration.
  const photoUrl = barn.photos && barn.photos[type];
  const [failed, setFailed] = useState(false);

  if (photoUrl && !failed) {
    return (
      <img
        src={photoUrl}
        alt={`${barn.name} — ${type}`}
        className="w-full h-full object-cover"
        onError={() => setFailed(true)}
      />
    );
  }
  if (type === "pasture") return <PastureScene barn={barn} />;
  if (type === "arena") return <ArenaScene barn={barn} />;
  if (type === "detail") return <DetailScene barn={barn} />;
  return <BarnScene barn={barn} />;
}

function PhotoVignette() {
  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{ background: "radial-gradient(ellipse at 50% 45%, transparent 50%, rgba(20,15,8,0.32) 100%)" }}
    />
  );
}

/* ---------------------------------- CARD ---------------------------------- */

function Nameplate({ children, size = "md" }) {
  const pad = size === "lg" ? "px-6 py-4" : "px-4 py-2.5";
  const text = size === "lg" ? "text-2xl md:text-3xl" : "text-base";
  return (
    <div
      className={`relative ${pad} rounded-sm`}
      style={{
        background: "linear-gradient(155deg, #D7B679 0%, #B78A4A 45%, #8f6a37 100%)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5), inset 0 -2px 3px rgba(0,0,0,0.25), 0 3px 6px rgba(0,0,0,0.35)",
      }}
    >
      <span
        className={`block font-bold tracking-wide ${text} text-center`}
        style={{
          fontFamily: "'Bitter', serif",
          color: "#2A2013",
          textShadow: "0 1px 0 rgba(255,255,255,0.35)",
          letterSpacing: "0.04em",
        }}
      >
        {children}
      </span>
      {["-6px_-6px", "-6px_6px", "6px_-6px", "6px_6px"].map((pos, i) => {
        const [x, y] = pos.split("_");
        return (
          <span
            key={i}
            className="absolute w-1.5 h-1.5 rounded-full"
            style={{
              background: "radial-gradient(circle at 35% 35%, #f2e2bb, #7a5a2c)",
              left: x.startsWith("-") ? "8px" : "auto",
              right: x.startsWith("-") ? "auto" : "8px",
              top: y.startsWith("-") ? "8px" : "auto",
              bottom: y.startsWith("-") ? "auto" : "8px",
            }}
          />
        );
      })}
    </div>
  );
}

function BarnCard({ barn, onOpen, saved, onToggleSave, distance }) {
  return (
    <button
      onClick={() => onOpen(barn.id)}
      className="text-left group rounded-xl overflow-hidden border transition-all duration-300 hover:-translate-y-1"
      style={{ background: "#E4D8BE", borderColor: "rgba(42,36,29,0.12)", boxShadow: "0 1px 3px rgba(0,0,0,0.15)" }}
    >
      <div className="relative h-40 overflow-hidden">
        <GalleryScene type="exterior" barn={barn} />
        <PhotoVignette />
        <div
          className="absolute bottom-1.5 left-2 flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded"
          style={{ background: "rgba(20,15,8,0.5)", color: "#F6EFDD" }}
        >
          {GALLERY.length} photos
        </div>
        <div
          onClick={(e) => { e.stopPropagation(); onToggleSave(barn.id); }}
          className="absolute top-2.5 right-2.5 w-8 h-8 rounded-full flex items-center justify-center cursor-pointer transition"
          style={{ background: "rgba(27,42,30,0.55)" }}
        >
          <Heart size={16} color="#F6EFDD" fill={saved ? "#F6EFDD" : "none"} />
        </div>
        <div className="absolute -bottom-4 left-4 right-4">
          <Nameplate>{barn.name}</Nameplate>
        </div>
      </div>
      <div className="pt-7 pb-4 px-4">
        <div className="flex items-center gap-1.5 text-xs" style={{ color: "#5C5240" }}>
          <MapPin size={13} />
          <span>{barn.town}, {barn.state}</span>
          <span className="mx-1">·</span>
          {barn.rating != null ? (
            <>
              <Star size={13} fill="#B78A4A" color="#B78A4A" />
              <span>{barn.rating} ({barn.reviews})</span>
            </>
          ) : (
            <span style={{ color: "#8A6D3B" }}>New listing</span>
          )}
          {distance != null && (
            <>
              <span className="mx-1">·</span>
              <span style={{ color: "#8A6D3B" }}>{Math.round(distance)} mi away</span>
            </>
          )}
        </div>
        <p className="mt-2 text-sm leading-snug" style={{ color: "#2A241D", fontFamily: "'Work Sans', sans-serif" }}>
          {barn.tagline}
        </p>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-wide px-2 py-1 rounded-full font-semibold"
            style={{ background: "rgba(122,46,40,0.1)", color: "#7A2E28" }}>
            {barn.board}
          </span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#2A241D" }} className="text-sm font-semibold">
            ${barn.price}<span className="text-xs font-normal" style={{ color: "#5C5240" }}>/mo</span>
          </span>
        </div>
      </div>
    </button>
  );
}

/* --------------------------------- DETAIL ---------------------------------- */

function BarnDetail({ barn, onBack, saved, onToggleSave, distance }) {
  const [sent, setSent] = useState(false);
  const [photoIndex, setPhotoIndex] = useState(0);
  const photo = GALLERY[photoIndex];
  const nextPhoto = () => setPhotoIndex((i) => (i + 1) % GALLERY.length);
  const prevPhoto = () => setPhotoIndex((i) => (i - 1 + GALLERY.length) % GALLERY.length);

  return (
    <div className="max-w-5xl mx-auto px-5 md:px-8 pb-24 pt-6">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm mb-5 font-medium transition hover:opacity-70"
        style={{ color: "#F6EFDD", fontFamily: "'Work Sans', sans-serif" }}
      >
        <ChevronLeft size={16} /> Back to all barns
      </button>

      <div className="rounded-2xl overflow-hidden" style={{ background: "#E4D8BE", boxShadow: "0 8px 30px rgba(0,0,0,0.35)" }}>
        <div className="relative h-56 md:h-72">
          <GalleryScene type={photo.type} barn={barn} />
          <PhotoVignette />

          <button
            onClick={prevPhoto}
            aria-label="Previous photo"
            className="absolute left-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center transition hover:opacity-90"
            style={{ background: "rgba(20,15,8,0.45)" }}
          >
            <ChevronLeft size={16} color="#F6EFDD" />
          </button>
          <button
            onClick={nextPhoto}
            aria-label="Next photo"
            className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center transition hover:opacity-90"
            style={{ background: "rgba(20,15,8,0.45)" }}
          >
            <ChevronRight size={16} color="#F6EFDD" />
          </button>

          <div
            className="absolute top-4 left-4 text-[11px] font-semibold px-2.5 py-1 rounded-full"
            style={{ background: "rgba(20,15,8,0.5)", color: "#F6EFDD" }}
          >
            {photoIndex + 1} / {GALLERY.length} · {photo.label}
          </div>

          <div
            onClick={() => onToggleSave(barn.id)}
            className="absolute top-4 right-4 w-10 h-10 rounded-full flex items-center justify-center cursor-pointer"
            style={{ background: "rgba(27,42,30,0.6)" }}
          >
            <Heart size={18} color="#F6EFDD" fill={saved ? "#F6EFDD" : "none"} />
          </div>
          <div className="absolute -bottom-7 left-6 right-6 md:left-8 md:right-auto md:w-[420px]">
            <Nameplate size="lg">{barn.name}</Nameplate>
          </div>
        </div>

        {/* thumbnail strip */}
        <div className="flex gap-2 px-6 md:px-8 pt-10 pb-1">
          {GALLERY.map((g, i) => (
            <button
              key={g.type}
              onClick={() => setPhotoIndex(i)}
              className="relative w-16 h-12 md:w-20 md:h-14 rounded-md overflow-hidden flex-shrink-0 transition"
              style={{
                outline: i === photoIndex ? "2px solid #B78A4A" : "2px solid transparent",
                outlineOffset: "1px",
                opacity: i === photoIndex ? 1 : 0.65,
              }}
            >
              <GalleryScene type={g.type} barn={barn} />
            </button>
          ))}
        </div>

        <div className="pt-6 pb-8 px-6 md:px-8">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm" style={{ color: "#5C5240" }}>
            <span className="flex items-center gap-1.5"><MapPin size={14} /> {barn.town}, {barn.state}</span>
            {barn.rating != null ? (
              <span className="flex items-center gap-1.5"><Star size={14} fill="#B78A4A" color="#B78A4A" /> {barn.rating} · {barn.reviews} reviews</span>
            ) : (
              <span className="flex items-center gap-1.5" style={{ color: "#8A6D3B" }}>New listing</span>
            )}
            {barn.established != null && (
              <span className="flex items-center gap-1.5"><Clock size={14} /> Boarding since {barn.established}</span>
            )}
            <span className="flex items-center gap-1.5"><Users size={14} /> Kept by {barn.keeper}</span>
            {distance != null && (
              <span className="flex items-center gap-1.5" style={{ color: "#8A6D3B" }}>
                <Navigation size={14} /> {Math.round(distance)} mi from you
              </span>
            )}
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {barn.tags.map((t) => (
              <span key={t} className="text-xs font-semibold uppercase tracking-wide px-2.5 py-1 rounded-full"
                style={{ background: "rgba(122,46,40,0.1)", color: "#7A2E28" }}>
                {t}
              </span>
            ))}
          </div>

          <p className="mt-6 leading-relaxed" style={{ color: "#2A241D", fontFamily: "'Work Sans', sans-serif" }}>
            {barn.story}
          </p>

          <div className="mt-8 grid sm:grid-cols-3 gap-4">
            <InfoBlock icon={<Fence size={16} />} label="Turnout" text={barn.turnout} />
            <InfoBlock icon={<HomeIcon size={16} />} label="Arena" text={barn.arena} />
            <InfoBlock icon={<TreePine size={16} />} label="Trails" text={barn.trails} />
          </div>

          <div className="mt-8">
            <h3 className="text-sm font-bold uppercase tracking-wide mb-3" style={{ color: "#7A2E28", fontFamily: "'Bitter', serif" }}>
              Amenities
            </h3>
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
              {barn.amenities.map((a) => (
                <div key={a} className="flex items-center gap-2 text-sm" style={{ color: "#2A241D" }}>
                  <ShieldCheck size={14} style={{ color: "#4C6B4F" }} />
                  {a}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-9 pt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4" style={{ borderTop: "1px solid rgba(42,36,29,0.15)" }}>
            <div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace" }} className="text-2xl font-bold" >
                ${barn.price}<span className="text-sm font-normal" style={{ color: "#5C5240" }}> / month · {barn.board}</span>
              </div>
              <div className="text-xs mt-1" style={{ color: "#5C5240" }}>{barn.stalls} stalls typically available</div>
            </div>
            <button
              onClick={() => setSent(true)}
              className="px-6 py-3 rounded-full font-semibold text-sm transition hover:opacity-90"
              style={{ background: "#7A2E28", color: "#F6EFDD", fontFamily: "'Work Sans', sans-serif" }}
            >
              {sent ? "Inquiry sent ✓" : "Request a stall"}
            </button>
          </div>
          {sent && (
            <p className="text-xs mt-3" style={{ color: "#5C5240" }}>
              This is a concept demo — no message was actually sent to {barn.keeper}.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoBlock({ icon, label, text }) {
  return (
    <div className="p-3.5 rounded-lg" style={{ background: "rgba(42,36,29,0.05)" }}>
      <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: "#7A2E28" }}>
        {icon} {label}
      </div>
      <p className="text-sm leading-snug" style={{ color: "#2A241D" }}>{text}</p>
    </div>
  );
}

/* --------------------------------- MAP VIEW --------------------------------- */

function BarnPin({ x, y, color, active, onClick }) {
  return (
    <g transform={`translate(${x},${y})`} onClick={onClick} style={{ cursor: "pointer" }}>
      {active && <circle r="10" fill={color} opacity="0.25" />}
      <g style={{ transform: active ? "scale(1.2)" : "scale(1)", transformOrigin: "0px 1px", transition: "transform 0.15s ease" }}>
        <path
          d="M0,1 C-5,-7 -8,-11 -8,-16 A8,8 0 1 1 8,-16 C8,-11 5,-7 0,1 Z"
          fill={color}
          stroke="#2A2013"
          strokeWidth="0.75"
        />
        <circle cx="0" cy="-16" r="3" fill="#F6EFDD" />
      </g>
    </g>
  );
}

function YouPin({ x, y }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <circle r="6" fill="none" stroke="#7A2E28" strokeWidth="1.5" opacity="0.55">
        <animate attributeName="r" values="5;13;5" dur="2.4s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.55;0;0.55" dur="2.4s" repeatCount="indefinite" />
      </circle>
      <circle r="4" fill="#7A2E28" stroke="#F6EFDD" strokeWidth="1.5" />
    </g>
  );
}

function CompassRose({ x, y }) {
  return (
    <g transform={`translate(${x},${y})`} opacity="0.55">
      <circle r="20" fill="none" stroke="#8f6a37" strokeWidth="1" />
      <path d="M0,-18 L4,0 L0,18 L-4,0 Z" fill="#7A2E28" opacity="0.85" />
      <path d="M-18,0 L0,4 L18,0 L0,-4 Z" fill="#8f6a37" opacity="0.7" />
      <text x="0" y="-24" textAnchor="middle" fontSize="8" fontFamily="'Bitter', serif" fill="#5C5240" fontWeight="700">N</text>
    </g>
  );
}

function MapView({ barns, userLoc, onOpenBarn }) {
  const [activeId, setActiveId] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState({ cx: MAP_W / 2, cy: MAP_H / 2 });
  const svgRef = useRef(null);
  const pointersRef = useRef(new Map());
  const dragRef = useRef({ dragging: false, moved: false, startX: 0, startY: 0, startCx: 0, startCy: 0 });
  const pinchRef = useRef(null);

  const active = barns.find((b) => b.id === activeId);
  const outlinePath = pathFromLonLat(US_OUTLINE);
  const longIslandPath = pathFromLonLat(LONG_ISLAND);
  const delmarvaPath = pathFromLonLat(DELMARVA);
  const ridgePoints = APPALACHIAN_RIDGE.map(project);
  const ridgePath = "M " + ridgePoints.map((p) => p.map((n) => n.toFixed(1)).join(",")).join(" L ");
  const userXY = userLoc ? project([userLoc.lon, userLoc.lat]) : null;

  const vw = MAP_W / zoom;
  const vh = MAP_H / zoom;
  const vx = Math.min(Math.max(center.cx - vw / 2, 0), MAP_W - vw);
  const vy = Math.min(Math.max(center.cy - vh / 2, 0), MAP_H - vh);

  const clampCenter = (cx, cy, z) => {
    const w = MAP_W / z, h = MAP_H / z;
    return {
      cx: Math.min(Math.max(cx, w / 2), MAP_W - w / 2),
      cy: Math.min(Math.max(cy, h / 2), MAP_H - h / 2),
    };
  };

  const zoomIn = () => setZoom((z) => Math.min(5, z * 1.6));
  const zoomOut = () =>
    setZoom((z) => {
      const nz = Math.max(1, z / 1.6);
      if (nz <= 1) setCenter({ cx: MAP_W / 2, cy: MAP_H / 2 });
      return nz;
    });
  const resetView = () => {
    setZoom(1);
    setCenter({ cx: MAP_W / 2, cy: MAP_H / 2 });
  };

  const onPointerDown = (e) => {
    svgRef.current?.setPointerCapture?.(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 1) {
      dragRef.current = { dragging: true, moved: false, startX: e.clientX, startY: e.clientY, startCx: center.cx, startCy: center.cy };
    } else if (pointersRef.current.size === 2) {
      dragRef.current.dragging = false;
      const pts = [...pointersRef.current.values()];
      pinchRef.current = { startDist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), startZoom: zoom };
    }
  };

  const onPointerMove = (e) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size >= 2 && pinchRef.current) {
      const pts = [...pointersRef.current.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const ratio = dist / (pinchRef.current.startDist || 1);
      setZoom(Math.min(5, Math.max(1, pinchRef.current.startZoom * ratio)));
      return;
    }

    const d = dragRef.current;
    if (!d.dragging) return;
    const dxCss = e.clientX - d.startX;
    const dyCss = e.clientY - d.startY;
    if (Math.abs(dxCss) > 3 || Math.abs(dyCss) > 3) d.moved = true;
    if (!d.moved) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) return;
    const scaleX = vw / rect.width;
    const scaleY = vh / rect.height;
    setCenter(clampCenter(d.startCx - dxCss * scaleX, d.startCy - dyCss * scaleY, zoom));
  };

  const onPointerUp = (e) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 0) dragRef.current.dragging = false;
  };

  const handlePinClick = (id) => {
    if (dragRef.current.moved) {
      dragRef.current.moved = false;
      return;
    }
    setActiveId(id === activeId ? null : id);
  };

  return (
    <div className="rounded-xl overflow-hidden relative" style={{ background: "#CBD8CE", boxShadow: "0 1px 3px rgba(0,0,0,0.15)" }}>
      <svg
        ref={svgRef}
        viewBox={`${vx.toFixed(2)} ${vy.toFixed(2)} ${vw.toFixed(2)} ${vh.toFixed(2)}`}
        className="w-full h-auto block"
        style={{ minHeight: 260, touchAction: "none", cursor: zoom > 1 ? "grab" : "default" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* ocean texture */}
        <g opacity="0.35" stroke="#9DB0AC" strokeWidth="1" fill="none">
          {Array.from({ length: 9 }).map((_, i) => (
            <path key={i} d={`M0,${i * 30 + 10} Q ${MAP_W / 4},${i * 30} ${MAP_W / 2},${i * 30 + 10} T ${MAP_W},${i * 30 + 10}`} />
          ))}
        </g>

        {/* landmasses */}
        <path d={outlinePath} fill="#E4D8BE" stroke="#B78A4A" strokeWidth="2.2" strokeLinejoin="round" />
        <path d={delmarvaPath} fill="#E4D8BE" stroke="#B78A4A" strokeWidth="1.4" strokeLinejoin="round" />
        <path d={longIslandPath} fill="#E4D8BE" stroke="#B78A4A" strokeWidth="1.4" strokeLinejoin="round" />

        {/* state borders, real geometry, solid and subtle */}
        <g fill="none" stroke="#8f6a37" strokeWidth="0.6" strokeLinejoin="round" opacity="0.4">
          {STATE_POLYGONS.map((line, i) => (
            <path key={i} d={pathFromLonLat(line)} />
          ))}
        </g>

        {/* Appalachian ridge, decorative only */}
        <path d={ridgePath} fill="none" stroke="#8f6a37" strokeWidth="1" strokeDasharray="1.5 3" opacity="0.4" />
        {ridgePoints.filter((_, i) => i % 2 === 0).map(([x, y], i) => (
          <polygon key={i} points={`${x - 4},${y + 3} ${x},${y - 3.5} ${x + 4},${y + 3}`} fill="#8f6a37" opacity="0.22" />
        ))}

        {/* Ocean label */}
        <text
          x={MAP_W - 78} y={MAP_H / 2 - 10}
          fontFamily="'Bitter', serif" fontStyle="italic" fontSize="9"
          letterSpacing="1.5" fill="#6f8079" opacity="0.6"
        >
          ATLANTIC
        </text>
        <text
          x={MAP_W - 74} y={MAP_H / 2}
          fontFamily="'Bitter', serif" fontStyle="italic" fontSize="9"
          letterSpacing="1.5" fill="#6f8079" opacity="0.6"
        >
          OCEAN
        </text>

        <CompassRose x={40} y={MAP_H - 40} />

        {barns.map((b) => {
          const [x, y] = project([b.lon, b.lat]);
          return (
            <BarnPin
              key={b.id}
              x={x}
              y={y}
              color={b.accent}
              active={activeId === b.id}
              onClick={() => handlePinClick(b.id)}
            />
          );
        })}
        {userXY && <YouPin x={userXY[0]} y={userXY[1]} />}

        {/* decorative frame */}
        <rect x="3" y="3" width={MAP_W - 6} height={MAP_H - 6} fill="none" stroke="#8f6a37" strokeWidth="1" opacity="0.4" />
      </svg>

      {/* zoom controls */}
      <div className="absolute top-3 right-3 flex flex-col gap-1.5">
        <button
          onClick={zoomIn}
          aria-label="Zoom in"
          className="w-8 h-8 rounded-full flex items-center justify-center transition hover:opacity-90"
          style={{ background: "rgba(20,15,8,0.6)" }}
        >
          <ZoomIn size={14} color="#F6EFDD" />
        </button>
        <button
          onClick={zoomOut}
          aria-label="Zoom out"
          className="w-8 h-8 rounded-full flex items-center justify-center transition hover:opacity-90"
          style={{ background: "rgba(20,15,8,0.6)" }}
        >
          <ZoomOut size={14} color="#F6EFDD" />
        </button>
        {zoom > 1 && (
          <button
            onClick={resetView}
            aria-label="Reset view"
            className="w-8 h-8 rounded-full flex items-center justify-center transition hover:opacity-90"
            style={{ background: "rgba(20,15,8,0.6)" }}
          >
            <RotateCcw size={13} color="#F6EFDD" />
          </button>
        )}
      </div>

      {active && (
        <div
          className="absolute left-3 right-3 bottom-3 md:left-4 md:right-auto md:w-72 rounded-lg p-3.5"
          style={{ background: "#F6EFDD", boxShadow: "0 6px 18px rgba(0,0,0,0.3)" }}
        >
          <button onClick={() => setActiveId(null)} className="absolute top-2 right-2 opacity-50 hover:opacity-100">
            <X size={14} />
          </button>
          <div
            className="font-bold text-sm pr-4"
            style={{ fontFamily: "'Bitter', serif", color: "#2A241D" }}
          >
            {active.name}
          </div>
          <div className="text-xs mt-1" style={{ color: "#5C5240" }}>
            {active.town}, {active.state} · ${active.price}/mo · {active.board}
          </div>
          {userLoc && (
            <div className="text-xs mt-0.5" style={{ color: "#8A6D3B" }}>
              {Math.round(active.distance)} mi from you
            </div>
          )}
          <button
            onClick={() => onOpenBarn(active.id)}
            className="mt-2.5 text-xs font-semibold px-3 py-1.5 rounded-full"
            style={{ background: "#7A2E28", color: "#F6EFDD" }}
          >
            View barn
          </button>
        </div>
      )}
      {!active && (
        <div
          className="absolute top-3 left-3 text-[11px] px-2.5 py-1 rounded-full"
          style={{ background: "rgba(42,36,29,0.55)", color: "#F6EFDD" }}
        >
          Drag to pan · pinch or use +/− to zoom
        </div>
      )}
    </div>
  );
}

/* ---------------------------------- APP ------------------------------------ */

/* --------------------------------- AUTH SCREEN ------------------------------ */

function AuthScreen({ onAuthed }) {
  const [mode, setMode] = useState("signup"); // signup | login
  const [role, setRole] = useState("renter"); // owner | renter
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [checkEmail, setCheckEmail] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (mode === "signup") {
        const data = await supabaseSignUp({ email, password, role, fullName });
        if (data.access_token) {
          onAuthed(data);
        } else {
          // No session yet — email confirmation is required first.
          setCheckEmail(true);
        }
      } else {
        const data = await supabaseLogin({ email, password });
        onAuthed(data);
      }
    } catch (err) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center px-5 py-12"
      style={{ background: "#1B2A1E" }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bitter:wght@600;700;800&family=Work+Sans:wght@400;500;600&family=JetBrains+Mono:wght@500;600&display=swap');
      `}</style>
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "#B78A4A" }}>
            <Fence size={17} color="#1B2A1E" />
          </div>
          <span style={{ fontFamily: "'Bitter', serif", color: "#F6EFDD" }} className="text-2xl font-bold tracking-wide">
            StableStay
          </span>
        </div>

        <div className="rounded-2xl p-6 md:p-8" style={{ background: "#E4D8BE", boxShadow: "0 8px 30px rgba(0,0,0,0.35)" }}>
          {checkEmail ? (
            <div className="text-center py-6">
              <Mail size={32} style={{ color: "#7A2E28", margin: "0 auto 14px" }} />
              <h2 className="text-lg font-bold mb-2" style={{ fontFamily: "'Bitter', serif", color: "#2A241D" }}>
                Check your email
              </h2>
              <p className="text-sm" style={{ color: "#5C5240" }}>
                We sent a confirmation link to <strong>{email}</strong>. Click it, then come back and log in below.
              </p>
              <button
                onClick={() => { setCheckEmail(false); setMode("login"); }}
                className="mt-5 text-sm font-semibold px-5 py-2.5 rounded-full"
                style={{ background: "#7A2E28", color: "#F6EFDD" }}
              >
                Go to login
              </button>
            </div>
          ) : (
            <>
              <h1 className="text-xl font-bold mb-1" style={{ fontFamily: "'Bitter', serif", color: "#2A241D" }}>
                {mode === "signup" ? "Create your account" : "Welcome back"}
              </h1>
              <p className="text-sm mb-5" style={{ color: "#5C5240" }}>
                {mode === "signup" ? "Join as a barn owner or someone looking for boarding." : "Log in to your StableStay account."}
              </p>

              {mode === "signup" && (
                <div className="grid grid-cols-2 gap-3 mb-5">
                  <button
                    type="button"
                    onClick={() => setRole("renter")}
                    className="text-left p-3.5 rounded-lg transition"
                    style={{
                      background: role === "renter" ? "rgba(122,46,40,0.12)" : "rgba(42,36,29,0.05)",
                      outline: role === "renter" ? "2px solid #7A2E28" : "2px solid transparent",
                    }}
                  >
                    <Search size={16} style={{ color: "#7A2E28" }} />
                    <div className="text-sm font-semibold mt-1.5" style={{ color: "#2A241D" }}>Looking for boarding</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRole("owner")}
                    className="text-left p-3.5 rounded-lg transition"
                    style={{
                      background: role === "owner" ? "rgba(122,46,40,0.12)" : "rgba(42,36,29,0.05)",
                      outline: role === "owner" ? "2px solid #7A2E28" : "2px solid transparent",
                    }}
                  >
                    <Fence size={16} style={{ color: "#7A2E28" }} />
                    <div className="text-sm font-semibold mt-1.5" style={{ color: "#2A241D" }}>I have a barn</div>
                  </button>
                </div>
              )}

              <form onSubmit={submit} className="space-y-3">
                {mode === "signup" && (
                  <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-lg" style={{ background: "#F3ECD8" }}>
                    <UserIcon size={15} style={{ color: "#8A6D3B" }} />
                    <input
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Your name"
                      required
                      className="flex-1 bg-transparent outline-none text-sm"
                      style={{ color: "#2A241D" }}
                    />
                  </div>
                )}
                <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-lg" style={{ background: "#F3ECD8" }}>
                  <Mail size={15} style={{ color: "#8A6D3B" }} />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Email"
                    required
                    className="flex-1 bg-transparent outline-none text-sm"
                    style={{ color: "#2A241D" }}
                  />
                </div>
                <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-lg" style={{ background: "#F3ECD8" }}>
                  <Lock size={15} style={{ color: "#8A6D3B" }} />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password (6+ characters)"
                    minLength={6}
                    required
                    className="flex-1 bg-transparent outline-none text-sm"
                    style={{ color: "#2A241D" }}
                  />
                </div>

                {error && (
                  <div
                    className="text-sm px-3.5 py-3 rounded-lg font-medium"
                    style={{ background: "rgba(122,46,40,0.12)", color: "#7A2E28", border: "1px solid rgba(122,46,40,0.3)" }}
                  >
                    ⚠ {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full text-sm font-semibold py-3 rounded-full transition hover:opacity-90 disabled:opacity-60"
                  style={{ background: "#7A2E28", color: "#F6EFDD" }}
                >
                  {loading ? "One moment…" : mode === "signup" ? "Create account" : "Log in"}
                </button>
              </form>

              <p className="text-center text-sm mt-5" style={{ color: "#5C5240" }}>
                {mode === "signup" ? "Already have an account?" : "New here?"}{" "}
                <button
                  onClick={() => { setMode(mode === "signup" ? "login" : "signup"); setError(""); }}
                  className="font-semibold underline"
                  style={{ color: "#7A2E28" }}
                >
                  {mode === "signup" ? "Log in" : "Create an account"}
                </button>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- OWNER DASHBOARD ----------------------------- */

function FieldInput({ label, value, onChange, placeholder, type = "text", required = false }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold mb-1.5" style={{ color: "#5C5240" }}>{label}</span>
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        className="w-full px-3.5 py-2.5 rounded-lg text-sm outline-none"
        style={{ background: "#F3ECD8", color: "#2A241D" }}
      />
    </label>
  );
}

function FieldTextarea({ label, value, onChange, placeholder, rows = 3 }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold mb-1.5" style={{ color: "#5C5240" }}>{label}</span>
      <textarea
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        rows={rows}
        className="w-full px-3.5 py-2.5 rounded-lg text-sm outline-none resize-none"
        style={{ background: "#F3ECD8", color: "#2A241D" }}
      />
    </label>
  );
}

function BarnForm({ session, onCreated, onCancel }) {
  const [form, setForm] = useState({
    name: "", town: "", state: "", price: "", boardType: "Full Care",
    stalls: "", tagline: "", story: "", turnout: "", arena: "", trails: "",
    amenities: "", tags: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const { lat, lon } = await geocodeTownState(form.town, form.state);
      const barn = {
        owner_id: session.user.id,
        name: form.name,
        town: form.town,
        state: form.state,
        lat,
        lon,
        price: form.price ? parseInt(form.price, 10) : null,
        board_type: form.boardType,
        stalls: form.stalls ? parseInt(form.stalls, 10) : null,
        tagline: form.tagline,
        story: form.story,
        turnout: form.turnout,
        arena: form.arena,
        trails: form.trails,
        amenities: form.amenities.split(",").map((s) => s.trim()).filter(Boolean),
        tags: form.tags.split(",").map((s) => s.trim()).filter(Boolean),
      };
      await createBarn(barn, session.access_token);
      onCreated();
    } catch (err) {
      setError(err.message || "Something went wrong saving that barn");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-4">
        <FieldInput label="Barn name" value={form.name} onChange={set("name")} placeholder="Willow Creek Farm" required />
        <FieldInput label="Tagline" value={form.tagline} onChange={set("tagline")} placeholder="A quiet valley barn built around turnout." />
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <FieldInput label="Town" value={form.town} onChange={set("town")} placeholder="Turnbridge" required />
        <FieldInput label="State" value={form.state} onChange={set("state")} placeholder="VT" required />
        <label className="block">
          <span className="block text-xs font-semibold mb-1.5" style={{ color: "#5C5240" }}>Board type</span>
          <select
            value={form.boardType}
            onChange={set("boardType")}
            className="w-full px-3.5 py-2.5 rounded-lg text-sm outline-none"
            style={{ background: "#F3ECD8", color: "#2A241D" }}
          >
            {BOARD_TYPES.filter((t) => t !== "All types").map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <FieldInput label="Price per month ($)" type="number" value={form.price} onChange={set("price")} placeholder="640" required />
        <FieldInput label="Stalls available" type="number" value={form.stalls} onChange={set("stalls")} placeholder="4" />
      </div>

      <FieldTextarea label="Full description" value={form.story} onChange={set("story")} placeholder="Tell renters about your barn — the people, the routine, what makes it worth boarding here." rows={4} />

      <div className="grid sm:grid-cols-3 gap-4">
        <FieldInput label="Turnout" value={form.turnout} onChange={set("turnout")} placeholder="Turned out 10+ hrs daily" />
        <FieldInput label="Arena" value={form.arena} onChange={set("arena")} placeholder="80x180 indoor arena" />
        <FieldInput label="Trails" value={form.trails} onChange={set("trails")} placeholder="State forest trail access" />
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <FieldInput label="Amenities (comma separated)" value={form.amenities} onChange={set("amenities")} placeholder="Heated wash stall, Tack lockers" />
        <FieldInput label="Tags (comma separated)" value={form.tags} onChange={set("tags")} placeholder="Indoor Arena, Trainer On-Site" />
      </div>

      {error && (
        <div
          className="text-sm px-3.5 py-3 rounded-lg font-medium"
          style={{ background: "rgba(122,46,40,0.12)", color: "#7A2E28", border: "1px solid rgba(122,46,40,0.3)" }}
        >
          ⚠ {error}
        </div>
      )}

      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={saving}
          className="text-sm font-semibold px-6 py-3 rounded-full transition hover:opacity-90 disabled:opacity-60"
          style={{ background: "#7A2E28", color: "#F6EFDD" }}
        >
          {saving ? "Saving…" : "List this barn"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm font-semibold px-5 py-3 rounded-full"
          style={{ color: "#5C5240" }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function MyBarnCard({ barn, onDelete }) {
  return (
    <div className="rounded-xl p-4 flex items-start justify-between gap-4" style={{ background: "#E4D8BE" }}>
      <div>
        <div className="font-bold text-sm" style={{ fontFamily: "'Bitter', serif", color: "#2A241D" }}>{barn.name}</div>
        <div className="text-xs mt-1" style={{ color: "#5C5240" }}>
          {barn.town}, {barn.state} · ${barn.price}/mo · {barn.board_type}
        </div>
        {!barn.lat && (
          <div className="text-xs mt-1" style={{ color: "#8A6D3B" }}>No map location yet — couldn't find that town automatically.</div>
        )}
      </div>
      <button
        onClick={() => onDelete(barn.id)}
        className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition hover:opacity-80"
        style={{ background: "rgba(122,46,40,0.1)", color: "#7A2E28" }}
        aria-label="Delete barn"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function OwnerDashboard({ session }) {
  const [myBarns, setMyBarns] = useState([]);
  const [loadingBarns, setLoadingBarns] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");

  const loadBarns = async () => {
    setLoadingBarns(true);
    setError("");
    try {
      const rows = await fetchMyBarns(session.user.id, session.access_token);
      setMyBarns(rows);
    } catch {
      setError("Couldn't load your barns right now.");
    } finally {
      setLoadingBarns(false);
    }
  };

  useEffect(() => {
    loadBarns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreated = () => {
    setShowForm(false);
    loadBarns();
  };

  const handleDelete = async (id) => {
    if (typeof window !== "undefined" && !window.confirm("Remove this barn listing?")) return;
    try {
      await deleteBarn(id, session.access_token);
      setMyBarns((b) => b.filter((x) => x.id !== id));
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-5 md:px-8 pt-10 pb-24">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold" style={{ fontFamily: "'Bitter', serif", color: "#F6EFDD" }}>
          Your barns
        </h1>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2.5 rounded-full transition hover:opacity-90"
            style={{ background: "#B78A4A", color: "#1B2A1E" }}
          >
            <Plus size={15} /> Add a barn
          </button>
        )}
      </div>

      {showForm ? (
        <div className="rounded-2xl p-6" style={{ background: "#E4D8BE" }}>
          <BarnForm session={session} onCreated={handleCreated} onCancel={() => setShowForm(false)} />
        </div>
      ) : loadingBarns ? (
        <p className="text-sm" style={{ color: "#C9C2AC" }}>Loading your barns…</p>
      ) : myBarns.length === 0 ? (
        <div className="rounded-2xl p-8 text-center" style={{ background: "rgba(246,239,221,0.06)" }}>
          <p className="text-sm" style={{ color: "#C9C2AC" }}>
            You haven't listed a barn yet. Click "Add a barn" to create your first listing.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {myBarns.map((b) => (
            <MyBarnCard key={b.id} barn={b} onDelete={handleDelete} />
          ))}
        </div>
      )}

      {error && (
        <p className="text-sm mt-4" style={{ color: "#D7B679" }}>{error}</p>
      )}
    </div>
  );
}

/* ---------------------------------- MAIN APP -------------------------------- */

function MainApp({ session, onLogout }) {
  const [view, setView] = useState({ page: "home" });
  const [query, setQuery] = useState("");
  const [boardType, setBoardType] = useState("All types");
  const [sort, setSort] = useState("recommended");
  const [saved, setSaved] = useState([]);
  const [userLoc, setUserLoc] = useState(null); // { lat, lon, label }
  const [locStatus, setLocStatus] = useState("idle"); // idle | locating | granted | denied | manual
  const [radius, setRadius] = useState("any");
  const [subview, setSubview] = useState("list"); // list | map
  const [realBarns, setRealBarns] = useState([]);

  useEffect(() => {
    fetchAllBarns().then(setRealBarns);
  }, []);

  const ALL_BARNS = useMemo(() => [...BARNS, ...realBarns], [realBarns]);

  const toggleSave = (id) =>
    setSaved((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const requestLocation = () => {
    if (!("geolocation" in navigator)) {
      setLocStatus("unsupported");
      return;
    }
    setLocStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLoc({ lat: pos.coords.latitude, lon: pos.coords.longitude, label: "your location" });
        setLocStatus("granted");
        setSort("distance");
      },
      () => setLocStatus("denied"),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 }
    );
  };

  const pickCity = (cityName) => {
    const c = REFERENCE_CITIES.find((c) => c.name === cityName);
    if (!c) return;
    setUserLoc({ lat: c.lat, lon: c.lon, label: c.name });
    setLocStatus("manual");
    setSort("distance");
  };

  const clearLocation = () => {
    setUserLoc(null);
    setLocStatus("idle");
    setSort("recommended");
    setRadius("any");
  };

  const filtered = useMemo(() => {
    let list = ALL_BARNS.map((b) => ({
      ...b,
      distance: userLoc ? distanceMiles(userLoc.lat, userLoc.lon, b.lat, b.lon) : null,
    }));
    list = list.filter((b) => {
      const q = query.trim().toLowerCase();
      const matchesQuery =
        !q ||
        b.name.toLowerCase().includes(q) ||
        b.town.toLowerCase().includes(q) ||
        b.state.toLowerCase().includes(q) ||
        b.tags.some((t) => t.toLowerCase().includes(q));
      const matchesType = boardType === "All types" || b.board === boardType;
      const matchesRadius = !userLoc || radius === "any" || b.distance <= Number(radius);
      return matchesQuery && matchesType && matchesRadius;
    });
    if (sort === "price-asc") list = [...list].sort((a, b) => a.price - b.price);
    if (sort === "price-desc") list = [...list].sort((a, b) => b.price - a.price);
    if (sort === "rating") list = [...list].sort((a, b) => b.rating - a.rating);
    if (sort === "distance" && userLoc) list = [...list].sort((a, b) => a.distance - b.distance);
    return list;
  }, [query, boardType, sort, userLoc, radius, ALL_BARNS]);

  const openBarn = (id) => {
    setView({ page: "detail", id });
    window.scrollTo?.(0, 0);
  };

  const activeBarn = view.page === "detail" ? ALL_BARNS.find((b) => b.id === view.id) : null;
  const activeBarnDistance =
    activeBarn && userLoc ? distanceMiles(userLoc.lat, userLoc.lon, activeBarn.lat, activeBarn.lon) : null;

  return (
    <div style={{ background: "#1B2A1E", minHeight: "100%" }} className="w-full">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bitter:wght@600;700;800&family=Work+Sans:wght@400;500;600&family=JetBrains+Mono:wght@500;600&display=swap');
      `}</style>

      {/* NAV */}
      <div className="sticky top-0 z-20" style={{ background: "rgba(27,42,30,0.92)", backdropFilter: "blur(6px)", borderBottom: "1px solid rgba(246,239,221,0.12)" }}>
        <div className="max-w-6xl mx-auto px-5 md:px-8 py-3.5 flex items-center justify-between">
          <div
            onClick={() => setView({ page: "home" })}
            className="flex items-center gap-2 cursor-pointer"
          >
            <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "#B78A4A" }}>
              <Fence size={15} color="#1B2A1E" />
            </div>
            <span style={{ fontFamily: "'Bitter', serif", color: "#F6EFDD" }} className="text-lg font-bold tracking-wide">
              StableStay
            </span>
          </div>
          <div className="flex items-center gap-3">
            {session?.profile?.role === "owner" && (
              <button
                onClick={() => setView({ page: "owner" })}
                className="text-xs font-semibold px-3 py-1.5 rounded-full transition hover:opacity-85"
                style={{
                  background: view.page === "owner" ? "#B78A4A" : "rgba(246,239,221,0.1)",
                  color: view.page === "owner" ? "#1B2A1E" : "#F6EFDD",
                }}
              >
                My Barns
              </button>
            )}
            <span
              className="hidden sm:inline text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full"
              style={{ background: "rgba(183,138,74,0.18)", color: "#D7B679", fontFamily: "'Work Sans', sans-serif" }}
            >
              {session?.profile?.role === "owner" ? "Barn owner" : "Renter"} account
            </span>
            <button
              onClick={onLogout}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full transition hover:opacity-85"
              style={{ background: "rgba(246,239,221,0.1)", color: "#F6EFDD" }}
            >
              <LogOut size={13} /> Log out
            </button>
          </div>
        </div>
      </div>

      {view.page === "owner" && <OwnerDashboard session={session} />}

      {view.page === "home" && (
        <>
          {/* HERO */}
          <div className="max-w-6xl mx-auto px-5 md:px-8 pt-14 pb-10 md:pt-20 md:pb-14">
            <div className="max-w-2xl">
              <h1
                style={{ fontFamily: "'Bitter', serif", color: "#F6EFDD" }}
                className="text-4xl md:text-5xl font-extrabold leading-[1.08] tracking-tight"
              >
                A stall for every horse, a home for every rider.
              </h1>
              <p className="mt-5 text-base md:text-lg leading-relaxed" style={{ color: "#C9C2AC", fontFamily: "'Work Sans', sans-serif" }}>
                Browse boarding barns the way you'd browse a place to stay — real turnout details,
                real board types, no phone tag with five different barn managers.
              </p>
            </div>

            {/* SEARCH BAR */}
            <div className="mt-8 flex flex-col md:flex-row gap-3 md:items-center">
              <div className="flex-1 flex items-center gap-2 px-4 py-3 rounded-full" style={{ background: "#EFE6D3" }}>
                <Search size={16} color="#7A2E28" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by barn, town, state, or amenity"
                  className="flex-1 bg-transparent outline-none text-sm"
                  style={{ color: "#2A241D", fontFamily: "'Work Sans', sans-serif" }}
                />
              </div>
              <div className="flex gap-3">
                <select
                  value={boardType}
                  onChange={(e) => setBoardType(e.target.value)}
                  className="px-4 py-3 rounded-full text-sm outline-none"
                  style={{ background: "#EFE6D3", color: "#2A241D", fontFamily: "'Work Sans', sans-serif" }}
                >
                  {BOARD_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                  className="px-4 py-3 rounded-full text-sm outline-none"
                  style={{ background: "#EFE6D3", color: "#2A241D", fontFamily: "'Work Sans', sans-serif" }}
                >
                  <option value="recommended">Recommended</option>
                  {userLoc && <option value="distance">Nearest to me</option>}
                  <option value="price-asc">Price: low to high</option>
                  <option value="price-desc">Price: high to low</option>
                  <option value="rating">Highest rated</option>
                </select>
              </div>
            </div>

            {/* LOCATION ROW */}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                onClick={requestLocation}
                className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-full transition hover:opacity-85"
                style={{ background: "#B78A4A", color: "#1B2A1E", fontFamily: "'Work Sans', sans-serif" }}
              >
                <LocateFixed size={14} /> {locStatus === "locating" ? "Locating…" : "Use my location"}
              </button>

              <div className="flex items-center gap-1.5 text-sm">
                <span style={{ color: "#8C917E" }}>or</span>
                <select
                  value=""
                  onChange={(e) => e.target.value && pickCity(e.target.value)}
                  className="px-3 py-2 rounded-full text-sm outline-none"
                  style={{ background: "#EFE6D3", color: "#2A241D", fontFamily: "'Work Sans', sans-serif" }}
                >
                  <option value="">choose a nearby city…</option>
                  {REFERENCE_CITIES.map((c) => (
                    <option key={c.name} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </div>

              {userLoc && (
                <div
                  className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-full"
                  style={{ background: "rgba(183,138,74,0.18)", color: "#D7B679" }}
                >
                  Near {userLoc.label}
                  <X size={13} className="cursor-pointer" onClick={clearLocation} />
                </div>
              )}

              {(locStatus === "denied" || locStatus === "unsupported") && !userLoc && (
                <span className="text-xs" style={{ color: "#8C917E" }}>
                  Location wasn't available here — pick a city instead.
                </span>
              )}
            </div>

            {userLoc && (
              <div className="mt-3">
                <select
                  value={radius}
                  onChange={(e) => setRadius(e.target.value)}
                  className="px-3 py-1.5 rounded-full text-xs outline-none"
                  style={{ background: "#EFE6D3", color: "#2A241D", fontFamily: "'Work Sans', sans-serif" }}
                >
                  <option value="any">Any distance</option>
                  <option value="100">Within 100 mi</option>
                  <option value="250">Within 250 mi</option>
                  <option value="500">Within 500 mi</option>
                </select>
              </div>
            )}
          </div>

          {/* GRID */}
          <div className="max-w-6xl mx-auto px-5 md:px-8 pb-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-1.5 text-sm" style={{ color: "#C9C2AC" }}>
                <SlidersHorizontal size={14} />
                {filtered.length} {filtered.length === 1 ? "barn" : "barns"} found
              </div>
              <div className="flex items-center gap-3">
                {saved.length > 0 && (
                  <div className="flex items-center gap-1.5 text-sm" style={{ color: "#D7B679" }}>
                    <Heart size={14} fill="#D7B679" /> {saved.length} saved
                  </div>
                )}
                <div className="flex items-center rounded-full p-1" style={{ background: "rgba(246,239,221,0.08)" }}>
                  <button
                    onClick={() => setSubview("list")}
                    className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-full transition"
                    style={{ background: subview === "list" ? "#B78A4A" : "transparent", color: subview === "list" ? "#1B2A1E" : "#C9C2AC" }}
                  >
                    <ListIcon size={13} /> List
                  </button>
                  <button
                    onClick={() => setSubview("map")}
                    className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-full transition"
                    style={{ background: subview === "map" ? "#B78A4A" : "transparent", color: subview === "map" ? "#1B2A1E" : "#C9C2AC" }}
                  >
                    <MapIcon size={13} /> Map
                  </button>
                </div>
              </div>
            </div>

            {filtered.length === 0 ? (
              <div className="py-20 text-center" style={{ color: "#C9C2AC" }}>
                No barns match that search. Try a different town, state, board type, or distance.
              </div>
            ) : subview === "map" ? (
              <div className="pb-16">
                <MapView barns={filtered} userLoc={userLoc} onOpenBarn={openBarn} />
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-9 pb-16">
                {filtered.map((b) => (
                  <BarnCard key={b.id} barn={b} onOpen={openBarn} saved={saved.includes(b.id)} onToggleSave={toggleSave} distance={b.distance} />
                ))}
              </div>
            )}
          </div>

          {/* FOOTER NOTE */}
          <div className="max-w-6xl mx-auto px-5 md:px-8 pb-14">
            <div className="rounded-xl px-6 py-5 flex items-start gap-3" style={{ background: "rgba(246,239,221,0.06)" }}>
              <Quote size={18} style={{ color: "#B78A4A", flexShrink: 0, marginTop: 2 }} />
              <p className="text-sm leading-relaxed" style={{ color: "#C9C2AC", fontFamily: "'Work Sans', sans-serif" }}>
                Every barn on this page is fictional — built to show what a horse-boarding marketplace
                could feel like. Real barn owners aren't listed here yet.
              </p>
            </div>
          </div>
        </>
      )}

      {view.page === "detail" && activeBarn && (
        <BarnDetail
          barn={activeBarn}
          onBack={() => setView({ page: "home" })}
          saved={saved.includes(activeBarn.id)}
          onToggleSave={toggleSave}
          distance={activeBarnDistance}
        />
      )}
    </div>
  );
}

/* ------------------------------ SESSION WRAPPER ------------------------------ */

export default function App() {
  const [session, setSession] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);

  const applySession = async (authData) => {
    let profile = null;
    try {
      profile = await fetchProfile(authData.user.id, authData.access_token);
    } catch {
      // profile fetch failing shouldn't block getting into the app
    }
    const next = {
      access_token: authData.access_token,
      refresh_token: authData.refresh_token,
      user: authData.user,
      profile,
    };
    setSession(next);
    try {
      localStorage.setItem("stablestay_session", JSON.stringify({ refresh_token: next.refresh_token }));
    } catch {
      // persistence is a nice-to-have, not required for the session to work
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const stored = localStorage.getItem("stablestay_session");
        const refreshToken = stored ? JSON.parse(stored).refresh_token : null;
        if (!refreshToken) {
          setCheckingSession(false);
          return;
        }
        const data = await supabaseRefresh(refreshToken);
        await applySession(data);
      } catch {
        // no valid stored session — that's fine, just show the login screen
      } finally {
        setCheckingSession(false);
      }
    })();
  }, []);

  const handleLogout = async () => {
    if (session?.access_token) await supabaseLogout(session.access_token);
    try {
      localStorage.removeItem("stablestay_session");
    } catch {}
    setSession(null);
  };

  if (checkingSession) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center" style={{ background: "#1B2A1E" }}>
        <span style={{ color: "#C9C2AC", fontFamily: "'Work Sans', sans-serif" }} className="text-sm">
          Loading…
        </span>
      </div>
    );
  }

  if (!session) {
    return <AuthScreen onAuthed={applySession} />;
  }

  return <MainApp session={session} onLogout={handleLogout} />;
}
