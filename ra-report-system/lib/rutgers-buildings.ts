// lib/rutgers-buildings.ts
// Coordinates verified manually via Google Maps

export interface BuildingMeta {
  name: string
  campus: string
  lat: number
  lng: number
}

export const RUTGERS_BUILDINGS: BuildingMeta[] = [
  // ── BUSCH ─────────────────────────────────────────────────────────────────
  { name: 'B.E.S.T Neighborhood',  campus: 'BUSCH', lat: 40.52241826025692,  lng: -74.45467234771725 },
  { name: 'Barr Hall',             campus: 'BUSCH', lat: 40.52206346056184,  lng: -74.45382994771728 },
  { name: 'Buell Apartments',      campus: 'BUSCH', lat: 40.521256715297696, lng: -74.45641814375155 },
  { name: 'Crosby Suites',         campus: 'BUSCH', lat: 40.52597990844962,  lng: -74.45947546120844 },
  { name: 'Johnson Apartments',    campus: 'BUSCH', lat: 40.527549486467215, lng: -74.46390415452365 },
  { name: 'Judson Suites',         campus: 'BUSCH', lat: 40.52587812588395,  lng: -74.45905559633333 },
  { name: 'Marvin Apartments',     campus: 'BUSCH', lat: 40.52044180830501,  lng: -74.45381514638254 },
  { name: 'McCormick Suites',      campus: 'BUSCH', lat: 40.52518531338025,  lng: -74.45875077284677 },
  { name: 'Metzger Hall',          campus: 'BUSCH', lat: 40.52111010708534,  lng: -74.45516004771724 },
  { name: 'Morrow Suites',         campus: 'BUSCH', lat: 40.52547475430609,  lng: -74.45989813051916 },
  { name: 'Nichols Apartments',    campus: 'BUSCH', lat: 40.5278044859085,   lng: -74.46594323547225 },
  { name: 'Richardson Apartments', campus: 'BUSCH', lat: 40.52650308712039,  lng: -74.46747824452902 },
  { name: 'Silvers Apartments',    campus: 'BUSCH', lat: 40.51961668932127,  lng: -74.45445184638258 },
  { name: 'Thomas Suites',         campus: 'BUSCH', lat: 40.525437307148096, lng: -74.45865652383483 },
  { name: 'Winkler Suites',        campus: 'BUSCH', lat: 40.525610871351724, lng: -74.4578647193994  },

  // ── COLLEGE AVE ───────────────────────────────────────────────────────────
  { name: 'Campbell Hall',                      campus: 'COLLEGE_AVE', lat: 40.50562070816152,   lng: -74.45089624030493 },
  { name: 'Frelinghuysen Hall',                 campus: 'COLLEGE_AVE', lat: 40.504102458928045,  lng: -74.44848579634056 },
  { name: 'Hardenbergh Hall',                   campus: 'COLLEGE_AVE', lat: 40.50482681564867,   lng: -74.44992369189897 },
  { name: 'Hegeman Hall',                       campus: 'COLLEGE_AVE', lat: 40.503424192853466,  lng: -74.44901405360737 },
  { name: 'Honors College',                     campus: 'COLLEGE_AVE', lat: 40.50231649548385,   lng: -74.44715016935815 },
  { name: 'Leupp Hall',                         campus: 'COLLEGE_AVE', lat: 40.50410345734119,   lng: -74.44956353052008 },
  { name: 'Mettler Hall',                       campus: 'COLLEGE_AVE', lat: 40.503080813722185,  lng: -74.4506586612096  },
  { name: 'Pell Hall',                          campus: 'COLLEGE_AVE', lat: 40.50387670832147,   lng: -74.44928023151692 },
  { name: 'Sojourner Truth Apartments',         campus: 'COLLEGE_AVE', lat: 40.49929733014691,   lng: -74.44820269004599 },
  { name: 'Stonier Hall',                       campus: 'COLLEGE_AVE', lat: 40.503348813135524,  lng: -74.45120833237341 },
  { name: 'Tinsley Hall',                       campus: 'COLLEGE_AVE', lat: 40.50259005682352,   lng: -74.45014447470115 },
  { name: 'University Center at Easton Avenue', campus: 'COLLEGE_AVE', lat: 40.49701496835007,   lng: -74.447584417029   },
  { name: 'Wessels Hall',                       campus: 'COLLEGE_AVE', lat: 40.503664008437894,  lng: -74.44975680023452 },

  // ── COOK / DOUGLASS ───────────────────────────────────────────────────────
  { name: 'Helyar House',            campus: 'COOK_DOUGLASS', lat: 40.47201242002781,  lng: -74.43583083793469 },
  { name: 'Henderson Apartments',    campus: 'COOK_DOUGLASS', lat: 40.48129312939181,  lng: -74.42718276913806 },
  { name: 'Jameson Hall',            campus: 'COOK_DOUGLASS', lat: 40.48466932879818,  lng: -74.4392918749353  },
  { name: 'Katzenbach Hall',         campus: 'COOK_DOUGLASS', lat: 40.48263187728486,  lng: -74.43137916121057 },
  { name: 'Lippincott Hall',         campus: 'COOK_DOUGLASS', lat: 40.48168866054575,  lng: -74.43056617655539 },
  { name: 'Newell Apartments',       campus: 'COOK_DOUGLASS', lat: 40.477625823915716, lng: -74.42978967243536 },
  { name: 'New Gibbons',             campus: 'COOK_DOUGLASS', lat: 40.48536585110711,  lng: -74.43143346121045 },
  { name: 'Nicholas Hall',           campus: 'COOK_DOUGLASS', lat: 40.481097258626285, lng: -74.43243565734464 },
  { name: 'Perry Hall',              campus: 'COOK_DOUGLASS', lat: 40.47725623817504,  lng: -74.43357171962614 },
  { name: 'Starkey Apartments',      campus: 'COOK_DOUGLASS', lat: 40.47603853474303,  lng: -74.43047595210831 },
  { name: 'Voorhees Residence Hall', campus: 'COOK_DOUGLASS', lat: 40.47662207163273,  lng: -74.43342674771935 },

  // ── LIVINGSTON ────────────────────────────────────────────────────────────
  { name: 'Livingston Apartments', campus: 'LIVINGSTON', lat: 40.525541767934136, lng: -74.43826754720037 },
  { name: 'Lynton Towers North',   campus: 'LIVINGSTON', lat: 40.523304280806244, lng: -74.43446572362458 },
  { name: 'Lynton Towers South',   campus: 'LIVINGSTON', lat: 40.523292111984546, lng: -74.43608148819156 },
  { name: 'Quad I',                campus: 'LIVINGSTON', lat: 40.52025541301837,  lng: -74.4357654638783  },
  { name: 'Quad II',               campus: 'LIVINGSTON', lat: 40.520059673364955, lng: -74.4344350881917  },
  { name: 'Quad III',              campus: 'LIVINGSTON', lat: 40.52072029240465,  lng: -74.4338986463826  },
]

export const CAMPUS_CENTERS: Record<string, { lat: number; lng: number; zoom: number }> = {
  'All':           { lat: 40.5020,  lng: -74.4450, zoom: 12   },
  'BUSCH':         { lat: 40.5235,  lng: -74.4580, zoom: 14.5 },
  'COLLEGE_AVE':   { lat: 40.5035,  lng: -74.4495, zoom: 14.5 },
  'COOK_DOUGLASS': { lat: 40.4775,  lng: -74.4320, zoom: 14   },
  'LIVINGSTON':    { lat: 40.5225,  lng: -74.4355, zoom: 14.5 },
}

export const CAMPUS_DISPLAY: Record<string, string> = {
  'BUSCH':         'Busch',
  'COLLEGE_AVE':   'College Ave',
  'COOK_DOUGLASS': 'Cook/Douglass',
  'LIVINGSTON':    'Livingston',
}