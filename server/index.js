import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import sharp from 'sharp';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 2 },
});

app.use(cors());
app.use(express.json({ limit: '1mb' }));

const CONDITIONS = [
  'Poor',
  'Good',
  'Fine',
  'Very Fine',
  'Extra Fine',
  'About Uncirculated',
  'Uncirculated',
  'Proof',
];

const GRADE_MULTIPLIERS = {
  Poor: 0.2,
  Good: 0.35,
  Fine: 0.55,
  'Very Fine': 0.75,
  'Extra Fine': 1,
  'About Uncirculated': 1.5,
  Uncirculated: 2.5,
  Proof: 3,
};

async function prepareImage(buffer) {
  return sharp(buffer)
    .rotate()
    .resize({ width: 2200, height: 2200, fit: 'inside', withoutEnlargement: true })
    .normalize()
    .sharpen({ sigma: 1.2 })
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();
}

async function callVision(buffer) {
  const key = process.env.GOOGLE_VISION_API_KEY;
  if (!key) throw new Error('GOOGLE_VISION_API_KEY is missing on the server');

  const body = {
    requests: [
      {
        image: { content: buffer.toString('base64') },
        features: [
          { type: 'TEXT_DETECTION', maxResults: 30 },
          { type: 'LABEL_DETECTION', maxResults: 20 },
          { type: 'WEB_DETECTION', maxResults: 20 },
          { type: 'IMAGE_PROPERTIES', maxResults: 5 },
        ],
      },
    ],
  };

  const { data } = await axios.post(
    'https://vision.googleapis.com/v1/images:annotate',
    body,
    {
      headers: {
        'x-goog-api-key': key,
        'Content-Type': 'application/json',
      },
      timeout: 45000,
    },
  );

  const response = data.responses?.[0] || {};
  if (response.error) {
    throw new Error(response.error.message || 'Google Vision rejected the image');
  }
  return response;
}

function detectedText(response) {
  return (response.textAnnotations?.[0]?.description || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectedLabels(response) {
  return [
    ...(response.labelAnnotations || []).map((item) => item.description),
    ...(response.webDetection?.webEntities || []).map((item) => item.description),
    ...(response.webDetection?.bestGuessLabels || []).map((item) => item.label),
  ].filter(Boolean);
}

function normalizeOcr(value = '') {
  return value
    .toUpperCase()
    .replace(/[|]/g, 'I')
    .replace(/0NE/g, 'ONE')
    .replace(/D0LLAR/g, 'DOLLAR')
    .replace(/TRVS[T]?/g, 'TRUST')
    .replace(/PLVRIBVS/g, 'PLURIBUS')
    .replace(/VNVM/g, 'UNUM')
    .replace(/\s+/g, ' ')
    .trim();
}

function getLikelyYear(text) {
  const currentYear = new Date().getFullYear();
  const years = (text.match(/\b(1[5-9]\d{2}|20[0-2]\d)\b/g) || [])
    .map(Number)
    .filter((year) => year >= 1500 && year <= currentYear);
  return years[0]?.toString() || 'Unknown';
}

function getMintMark(text) {
  const upper = normalizeOcr(text);
  const explicit = upper.match(/\bMINT\s*(?:MARK)?\s*[:\-]?\s*([DPSWCCO])\b/);
  if (explicit) return explicit[1];

  const parenthetical = upper.match(/\b\d{4}\s*[- ]?([DPSW])\b/);
  if (parenthetical) return parenthetical[1];

  return 'None seen';
}

function addCandidate(map, key, label, score, reasons = []) {
  const current = map.get(key) || { key, label, score: 0, reasons: [] };
  current.score += score;
  current.reasons.push(...reasons);
  map.set(key, current);
}

function buildCoinCandidates(frontText, backText, labelList) {
  const front = normalizeOcr(frontText);
  const back = normalizeOcr(backText);
  const allText = `${front} ${back}`;
  const all = `${allText} ${labelList.join(' ')}`.toUpperCase();
  const year = Number(getLikelyYear(allText));
  const candidates = new Map();

  const has = (pattern) => pattern.test(all);
  const frontHas = (pattern) => pattern.test(front);
  const backHas = (pattern) => pattern.test(back);

  const oneDollar = has(/\bONE\s+DOLLAR\b|\b1\s+DOLLAR\b/);
  const halfDollar = has(/\bHALF\s+DOLLAR\b|\b50\s+CENTS?\b/);
  const quarterDollar = has(/\bQUARTER\s+DOLLAR\b|\b25\s+CENTS?\b/);
  const tenCents = has(/\bTEN\s+CENTS?\b|\b10\s+CENTS?\b|\bONE\s+DIME\b/);
  const fiveCents = has(/\bFIVE\s+CENTS?\b|\b5\s+CENTS?\b/);
  const oneCent = has(/\bONE\s+CENT\b|\b1\s+CENT\b|\bPENNY\b/);
  const explicitCents = oneCent || fiveCents || tenCents || quarterDollar || halfDollar;

  if (oneDollar) {
    addCandidate(candidates, 'us-dollar', 'United States Dollar Coin', 90, ['Reverse text says ONE DOLLAR']);
  }
  if (halfDollar) addCandidate(candidates, 'half-dollar', 'United States Half Dollar', 90, ['Denomination text says HALF DOLLAR']);
  if (quarterDollar) addCandidate(candidates, 'quarter', 'United States Quarter', 90, ['Denomination text says QUARTER DOLLAR']);
  if (tenCents) addCandidate(candidates, 'dime', 'United States Dime', 90, ['Denomination text says TEN CENTS or ONE DIME']);
  if (fiveCents) addCandidate(candidates, 'five-cents', 'United States Five-Cent Coin', 90, ['Denomination text says FIVE CENTS']);
  if (oneCent) addCandidate(candidates, 'one-cent', 'United States One-Cent Coin', 90, ['Denomination text says ONE CENT']);

  const usClues = has(/UNITED\s+STATES|LIBERTY|IN\s+GOD\s+WE\s+TRUST|E\s*PLURIBUS\s*UNUM/);
  const eagleClue = has(/EAGLE|BALD\s+EAGLE/);
  const silverClue = has(/SILVER|SILVER\s+DOLLAR|MORGAN\s+DOLLAR|PEACE\s+DOLLAR/);

  // Peace dollar: 1921-1935, LIBERTY and IN GOD WE TRUST on front, ONE DOLLAR on reverse.
  let peaceScore = 0;
  const peaceReasons = [];
  if (year >= 1921 && year <= 1935) { peaceScore += 35; peaceReasons.push('Date is inside Peace Dollar years (1921-1935)'); }
  if (frontHas(/LIBERTY/)) { peaceScore += 15; peaceReasons.push('Front reads LIBERTY'); }
  if (frontHas(/IN\s+GOD\s+WE\s+TRUST/) || has(/GOD\s+WE\s+TRUST/)) { peaceScore += 20; peaceReasons.push('Reads IN GOD WE TRUST'); }
  if (oneDollar) { peaceScore += 45; peaceReasons.push('Reverse reads ONE DOLLAR'); }
  if (backHas(/PEACE/) || has(/PEACE\s+DOLLAR/)) { peaceScore += 30; peaceReasons.push('PEACE clue detected'); }
  if (eagleClue) { peaceScore += 10; peaceReasons.push('Eagle clue detected'); }
  if (peaceScore > 0) addCandidate(candidates, 'peace-dollar', 'Peace Silver Dollar', peaceScore, peaceReasons);

  // Morgan dollar: 1878-1921, E PLURIBUS UNUM and ONE DOLLAR.
  let morganScore = 0;
  const morganReasons = [];
  if (year >= 1878 && year <= 1921) { morganScore += 35; morganReasons.push('Date is inside Morgan Dollar years (1878-1921)'); }
  if (frontHas(/E\s*PLURIBUS\s*UNUM/) || has(/PLURIBUS\s+UNUM/)) { morganScore += 25; morganReasons.push('Front reads E PLURIBUS UNUM'); }
  if (oneDollar) { morganScore += 45; morganReasons.push('Reverse reads ONE DOLLAR'); }
  if (has(/MORGAN\s+DOLLAR/)) { morganScore += 50; morganReasons.push('Morgan Dollar label detected'); }
  if (eagleClue) { morganScore += 10; morganReasons.push('Eagle clue detected'); }
  if (morganScore > 0) addCandidate(candidates, 'morgan-dollar', 'Morgan Silver Dollar', morganScore, morganReasons);

  // Liberty Head/V nickel requires denomination evidence. Portrait similarity alone is never enough.
  let vNickelScore = 0;
  const vNickelReasons = [];
  if (year >= 1883 && year <= 1913) { vNickelScore += 20; vNickelReasons.push('Date is inside Liberty Head Nickel years (1883-1913)'); }
  if (fiveCents) { vNickelScore += 60; vNickelReasons.push('Reads FIVE CENTS'); }
  if (backHas(/\bV\b/) && backHas(/CENTS?/)) { vNickelScore += 50; vNickelReasons.push('Reverse appears to show V and CENTS'); }
  if (has(/LIBERTY\s+HEAD\s+NICKEL|V\s+NICKEL/)) { vNickelScore += 35; vNickelReasons.push('Liberty Head/V Nickel label detected'); }
  if (oneDollar) { vNickelScore -= 100; vNickelReasons.push('Rejected because ONE DOLLAR was detected'); }
  if (vNickelScore > 0) addCandidate(candidates, 'liberty-head-nickel', 'Liberty Head Five-Cent Nickel (V Nickel)', vNickelScore, vNickelReasons);

  if (has(/BUFFALO\s+NICKEL|INDIAN\s+HEAD\s+NICKEL/) && fiveCents) {
    addCandidate(candidates, 'buffalo-nickel', 'Buffalo / Indian Head Nickel', 110, ['Buffalo/Indian Head Nickel label and FIVE CENTS detected']);
  }

  if (has(/LINCOLN/) && oneCent) addCandidate(candidates, 'lincoln-cent', 'Lincoln Cent', 110, ['Lincoln clue and ONE CENT detected']);
  if (has(/WHEAT/) && oneCent) addCandidate(candidates, 'wheat-cent', 'Lincoln Wheat Cent', 130, ['Wheat clue and ONE CENT detected']);
  if (has(/MERCURY\s+DIME/) && tenCents) addCandidate(candidates, 'mercury-dime', 'Mercury Dime', 130, ['Mercury Dime clue and dime denomination detected']);
  if (has(/WASHINGTON/) && quarterDollar) addCandidate(candidates, 'washington-quarter', 'Washington Quarter', 120, ['Washington clue and quarter denomination detected']);
  if (has(/AMERICAN\s+SILVER\s+EAGLE/) && oneDollar) addCandidate(candidates, 'silver-eagle', 'American Silver Eagle', 160, ['American Silver Eagle label and ONE DOLLAR detected']);

  if (oneDollar && !candidates.has('peace-dollar') && !candidates.has('morgan-dollar')) {
    addCandidate(candidates, 'unknown-dollar', 'Unknown United States Dollar Coin', 95, ['ONE DOLLAR was detected but the exact series is uncertain']);
  }

  // Do not infer five cents merely because a web label says nickel.
  if (!explicitCents && !oneDollar && usClues) {
    addCandidate(candidates, 'unknown-us-coin', 'Unknown United States Coin', 35, ['United States coin wording detected, but denomination is unclear']);
  }

  if (silverClue && oneDollar) {
    addCandidate(candidates, 'silver-dollar-generic', 'United States Silver Dollar', 105, ['Silver and ONE DOLLAR clues detected']);
  }

  return [...candidates.values()]
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function coinIdentityFromCandidate(candidate, text, labels, year) {
  const combined = `${normalizeOcr(text)} ${labels.join(' ')}`.toUpperCase();
  const country = /UNITED\s+STATES|LIBERTY|IN\s+GOD\s+WE\s+TRUST|E\s*PLURIBUS\s*UNUM/.test(combined)
    ? 'United States'
    : 'Unknown';

  const map = {
    'peace-dollar': { denomination: '1 Dollar', variety: 'Peace Silver Dollar', material: 'Silver' },
    'morgan-dollar': { denomination: '1 Dollar', variety: 'Morgan Silver Dollar', material: 'Silver' },
    'silver-dollar-generic': { denomination: '1 Dollar', variety: 'United States Silver Dollar', material: 'Silver' },
    'us-dollar': { denomination: '1 Dollar', variety: 'United States Dollar Coin', material: /SILVER/.test(combined) ? 'Silver' : 'Unknown' },
    'unknown-dollar': { denomination: '1 Dollar', variety: 'Unknown United States Dollar Coin', material: /SILVER/.test(combined) ? 'Silver' : 'Unknown' },
    'liberty-head-nickel': { denomination: '5 Cents', variety: 'Liberty Head Five-Cent Nickel (V Nickel)', material: 'Nickel alloy' },
    'buffalo-nickel': { denomination: '5 Cents', variety: 'Buffalo / Indian Head Nickel', material: 'Nickel alloy' },
    'five-cents': { denomination: '5 Cents', variety: 'United States Five-Cent Coin', material: 'Nickel alloy' },
    'lincoln-cent': { denomination: '1 Cent', variety: 'Lincoln Cent', material: 'Copper/Bronze' },
    'wheat-cent': { denomination: '1 Cent', variety: 'Lincoln Wheat Cent', material: 'Copper/Bronze' },
    'one-cent': { denomination: '1 Cent', variety: 'United States One-Cent Coin', material: 'Copper/Bronze' },
    'mercury-dime': { denomination: '10 Cents', variety: 'Mercury Dime', material: 'Silver' },
    dime: { denomination: '10 Cents', variety: 'United States Dime', material: /SILVER/.test(combined) ? 'Silver' : 'Unknown' },
    quarter: { denomination: '25 Cents', variety: 'United States Quarter', material: /SILVER/.test(combined) ? 'Silver' : 'Unknown' },
    'washington-quarter': { denomination: '25 Cents', variety: 'Washington Quarter', material: /SILVER/.test(combined) ? 'Silver' : 'Unknown' },
    'half-dollar': { denomination: 'Half Dollar', variety: 'United States Half Dollar', material: /SILVER/.test(combined) ? 'Silver' : 'Unknown' },
    'silver-eagle': { denomination: '1 Dollar', variety: 'American Silver Eagle', material: 'Silver' },
    'unknown-us-coin': { denomination: 'Unknown coin', variety: 'Unknown United States Coin', material: /SILVER/.test(combined) ? 'Silver or silver-colored' : 'Unknown' },
  };

  return {
    country,
    denomination: map[candidate?.key]?.denomination || 'Unknown coin',
    variety: map[candidate?.key]?.variety || candidate?.label || 'Unknown coin',
    material: map[candidate?.key]?.material || 'Unknown',
    mint_mark: getMintMark(text),
    year,
  };
}

function imageQuality(metadata) {
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  if (width >= 1600 && height >= 1600) return 'Good';
  if (width >= 900 && height >= 900) return 'Fair';
  return 'Low resolution';
}

function coinBaseEstimate(identity) {
  const year = Number(identity.year);
  const text = `${identity.variety} ${identity.denomination} ${identity.material}`.toLowerCase();
  let base = 2;

  if (/morgan silver dollar/.test(text)) base = 45;
  else if (/peace silver dollar/.test(text)) base = 38;
  else if (/silver dollar|silver eagle/.test(text)) base = 35;
  else if (/half dollar/.test(text) && /silver/.test(text)) base = 16;
  else if (/quarter/.test(text) && /silver/.test(text)) base = 8;
  else if (/dime/.test(text) && /silver/.test(text)) base = 4;
  else if (/liberty head.*nickel|v nickel/.test(text)) base = 6;
  else if (/buffalo/.test(text)) base = 4;
  else if (/wheat/.test(text)) base = 1.5;

  if (year && year < 1900) base *= 1.35;
  if (year && year < 1800) base *= 4;
  if (identity.mint_mark === 'CC') base *= 8;
  else if (['S', 'W', 'O'].includes(identity.mint_mark)) base *= 1.35;

  // A likely silver dollar should never be priced like a nickel.
  if (identity.denomination === '1 Dollar' && /silver/.test(text)) base = Math.max(base, 30);
  return Math.max(0.1, base);
}

function conditionEstimates(base) {
  return CONDITIONS.map((condition) => ({
    condition,
    value_low: +(base * GRADE_MULTIPLIERS[condition] * 0.65).toFixed(2),
    value_high: +(base * GRADE_MULTIPLIERS[condition] * 1.75).toFixed(2),
  }));
}

function marketLinks(query, itemType = 'coin') {
  const encoded = encodeURIComponent(query);
  const links = [
    { label: 'eBay current listings', url: `https://www.ebay.com/sch/i.html?_nkw=${encoded}` },
    { label: 'eBay sold comparison', url: `https://www.ebay.com/sch/i.html?_nkw=${encoded}&LH_Sold=1&LH_Complete=1` },
  ];

  if (itemType === 'coin') {
    links.push(
      { label: 'PCGS CoinFacts', url: `https://www.google.com/search?q=site%3Apcgs.com%2Fcoinfacts+${encoded}` },
      { label: 'Numista catalog', url: `https://en.numista.com/catalogue/index.php?r=${encoded}&ct=coin` },
      { label: 'NGC Coin Explorer', url: `https://www.google.com/search?q=site%3Angccoin.com+${encoded}` },
    );
  } else {
    links.push(
      { label: 'PMG paper money search', url: `https://www.google.com/search?q=site%3Apmgnotes.com+${encoded}` },
      { label: 'Heritage Auctions search', url: `https://www.google.com/search?q=site%3Aha.com+${encoded}` },
    );
  }

  return links;
}

function identifyCurrency(frontText, backText, labels) {
  const front = normalizeOcr(frontText);
  const back = normalizeOcr(backText);
  const all = `${front} ${back} ${labels.join(' ')}`.toUpperCase();
  const series = getLikelyYear(all);
  const denominationRules = [
    [/\bONE\s+DOLLAR\b|\$1\b/, '1 Dollar'],
    [/\bTWO\s+DOLLARS?\b|\$2\b/, '2 Dollars'],
    [/\bFIVE\s+DOLLARS?\b|\$5\b/, '5 Dollars'],
    [/\bTEN\s+DOLLARS?\b|\$10\b/, '10 Dollars'],
    [/\bTWENTY\s+DOLLARS?\b|\$20\b/, '20 Dollars'],
    [/\bFIFTY\s+DOLLARS?\b|\$50\b/, '50 Dollars'],
    [/\bONE\s+HUNDRED\s+DOLLARS?\b|\$100\b/, '100 Dollars'],
  ];
  let denomination = 'Unknown note';
  for (const [pattern, value] of denominationRules) {
    if (pattern.test(all)) { denomination = value; break; }
  }

  let noteType = 'United States Note';
  if (/SILVER\s+CERTIFICATE/.test(all)) noteType = 'Silver Certificate';
  else if (/GOLD\s+CERTIFICATE/.test(all)) noteType = 'Gold Certificate';
  else if (/FEDERAL\s+RESERVE\s+NOTE/.test(all)) noteType = 'Federal Reserve Note';
  else if (/UNITED\s+STATES\s+NOTE|LEGAL\s+TENDER/.test(all)) noteType = 'United States / Legal Tender Note';
  else if (/NATIONAL\s+CURRENCY|NATIONAL\s+BANK/.test(all)) noteType = 'National Bank Note';

  const serialMatch = all.match(/\b[A-Z]{0,2}\d{8}[A-Z*]?\b/);
  const serial_number = serialMatch?.[0] || 'Not clearly read';
  const star_note = /\d\*/.test(serial_number) || /STAR\s+NOTE/.test(all);
  const large_size = series !== 'Unknown' && Number(series) < 1928;

  return {
    item_type: 'currency',
    country: /UNITED\s+STATES|FEDERAL\s+RESERVE/.test(all) ? 'United States' : 'Unknown',
    denomination,
    year: series,
    variety: noteType,
    material: 'Paper currency',
    mint_mark: 'Not applicable',
    serial_number,
    star_note,
    size_class: large_size ? 'Large-size note' : 'Small-size or unknown',
  };
}

function currencyBaseEstimate(identity) {
  const year = Number(identity.year);
  const denom = Number(identity.denomination.match(/\d+/)?.[0] || 1);
  let base = Math.max(denom, 2);
  if (/SILVER CERTIFICATE/i.test(identity.variety)) base *= 2.5;
  if (/GOLD CERTIFICATE/i.test(identity.variety)) base *= 8;
  if (/LEGAL TENDER|UNITED STATES/i.test(identity.variety)) base *= 3;
  if (/NATIONAL BANK/i.test(identity.variety)) base *= 6;
  if (identity.star_note) base *= 2;
  if (year && year <= 1928) base *= 3;
  if (identity.size_class === 'Large-size note') base *= 4;
  return Math.max(base, denom);
}

app.get('/api/health', (req, res) => res.json({ status: 'running', version: '2.0' }));

app.post(
  '/api/analyze',
  upload.fields([
    { name: 'front', maxCount: 1 },
    { name: 'back', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const frontFile = req.files?.front?.[0];
      const backFile = req.files?.back?.[0];
      if (!frontFile || !backFile) {
        return res.status(400).json({ error: 'Both front and back photos are required.' });
      }

      const itemType = req.body?.item_type === 'currency' ? 'currency' : 'coin';
      const [frontBuffer, backBuffer] = await Promise.all([
        prepareImage(frontFile.buffer),
        prepareImage(backFile.buffer),
      ]);
      const [frontVision, backVision, frontMeta, backMeta] = await Promise.all([
        callVision(frontBuffer),
        callVision(backBuffer),
        sharp(frontBuffer).metadata(),
        sharp(backBuffer).metadata(),
      ]);

      const frontText = detectedText(frontVision);
      const backText = detectedText(backVision);
      const labels = [...new Set([...detectedLabels(frontVision), ...detectedLabels(backVision)])].slice(0, 30);
      const combinedText = [frontText, backText].filter(Boolean).join(' | ');
      const year = getLikelyYear(combinedText);
      const image_quality = `Front: ${imageQuality(frontMeta)}; Back: ${imageQuality(backMeta)}`;

      if (itemType === 'currency') {
        const identity = identifyCurrency(frontText, backText, labels);
        const estimates = conditionEstimates(currencyBaseEstimate(identity));
        const query = [identity.year, identity.denomination, identity.variety, identity.serial_number !== 'Not clearly read' ? identity.serial_number : '', 'paper money'].filter(Boolean).join(' ');
        const confidence = identity.denomination !== 'Unknown note' && identity.year !== 'Unknown' ? 'medium' : 'low';

        return res.json({
          ...identity,
          front_text: frontText.slice(0, 300),
          back_text: backText.slice(0, 300),
          detected_text: combinedText.slice(0, 500),
          labels,
          image_quality,
          confidence,
          candidates: [],
          needs_confirmation: confidence !== 'high',
          suggested_condition: 'Fine',
          condition_estimates: estimates,
          estimate: estimates.find((item) => item.condition === 'Fine'),
          price_note: 'Estimate only. Confirm rare notes with sold listings or a professional paper-money grader.',
          value_explanation: 'The estimate uses the denomination, series year, note type, star-note clue, size class, and selected condition. The identification should be confirmed before relying on the price.',
          market_query: query,
          market_links: marketLinks(query, 'currency'),
        });
      }

      const candidates = buildCoinCandidates(frontText, backText, labels);
      const topCandidate = candidates[0] || {
        key: 'unknown-us-coin',
        label: 'Unknown Coin',
        score: 0,
        reasons: ['Not enough reliable denomination or series evidence'],
      };
      const identity = coinIdentityFromCandidate(topCandidate, combinedText, labels, year);
      const estimates = conditionEstimates(coinBaseEstimate(identity));

      const scoreGap = (candidates[0]?.score || 0) - (candidates[1]?.score || 0);
      const confidence = topCandidate.score >= 125 && scoreGap >= 25
        ? 'high'
        : topCandidate.score >= 80
          ? 'medium'
          : 'low';
      const needsConfirmation = confidence !== 'high' || identity.denomination === 'Unknown coin';
      const query = [
        identity.year !== 'Unknown' ? identity.year : '',
        identity.mint_mark !== 'None seen' ? identity.mint_mark : '',
        identity.variety || identity.denomination,
        identity.country,
        'coin',
      ].filter(Boolean).join(' ');

      return res.json({
        item_type: 'coin',
        ...identity,
        front_text: frontText.slice(0, 300),
        back_text: backText.slice(0, 300),
        detected_text: combinedText.slice(0, 500),
        labels,
        image_quality,
        confidence,
        candidates,
        identification_reasons: topCandidate.reasons,
        needs_confirmation: needsConfirmation,
        suggested_condition: 'Fine',
        condition_estimates: estimates,
        estimate: estimates.find((item) => item.condition === 'Fine'),
        price_note: 'Estimate only. Confirm the identification and compare sold listings before buying or selling.',
        value_explanation: 'The engine now gives denomination text and the reverse image more weight than portrait similarity. A dollar cannot be reduced to five cents merely because the Liberty portrait resembles a nickel.',
        market_query: query,
        market_links: marketLinks(query, 'coin'),
      });
    } catch (error) {
      console.error(error.response?.data || error);
      return res.status(500).json({
        error: error.response?.data?.error?.message || error.message || 'Analysis failed',
      });
    }
  },
);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, '../dist');
app.use(express.static(dist));
app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`RedEye Coin & Currency Scanner running on ${port}`));
