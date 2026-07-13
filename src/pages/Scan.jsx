import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Loader2,
  RefreshCw,
  Save,
  Search,
  AlertTriangle,
  ExternalLink,
  CheckCircle2,
  Coins,
  Banknote,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import PhotoCapture from '../components/PhotoCapture.jsx';
import { CONDITIONS, fileToDataUrl, loadCoins, saveCoins, money } from '../lib.js';

function buildQuery(form, itemType) {
  const parts = [
    form.year !== 'Unknown' ? form.year : '',
    form.mint_mark && !['None seen', 'Not applicable'].includes(form.mint_mark) ? form.mint_mark : '',
    form.variety || form.denomination,
    form.country,
    itemType === 'currency' ? 'paper money' : 'coin',
  ];
  return parts.filter(Boolean).join(' ');
}

function buildLinks(query, itemType) {
  const q = encodeURIComponent(query);
  const links = [
    { label: 'eBay current listings', url: `https://www.ebay.com/sch/i.html?_nkw=${q}` },
    { label: 'eBay sold comparison', url: `https://www.ebay.com/sch/i.html?_nkw=${q}&LH_Sold=1&LH_Complete=1` },
  ];

  if (itemType === 'currency') {
    links.push(
      { label: 'PMG paper money search', url: `https://www.google.com/search?q=site%3Apmgnotes.com+${q}` },
      { label: 'Heritage Auctions search', url: `https://www.google.com/search?q=site%3Aha.com+${q}` },
    );
  } else {
    links.push(
      { label: 'PCGS CoinFacts', url: `https://www.google.com/search?q=site%3Apcgs.com%2Fcoinfacts+${q}` },
      { label: 'Numista catalog', url: `https://en.numista.com/catalogue/index.php?r=${q}&ct=coin` },
      { label: 'NGC Coin Explorer', url: `https://www.google.com/search?q=site%3Angccoin.com+${q}` },
    );
  }
  return links;
}

export default function Scan() {
  const navigate = useNavigate();
  const [itemType, setItemType] = useState('coin');
  const [front, setFront] = useState(null);
  const [back, setBack] = useState(null);
  const [frontPreview, setFrontPreview] = useState('');
  const [backPreview, setBackPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [condition, setCondition] = useState('Fine');
  const [form, setForm] = useState(null);

  useEffect(() => () => {
    if (frontPreview?.startsWith('blob:')) URL.revokeObjectURL(frontPreview);
    if (backPreview?.startsWith('blob:')) URL.revokeObjectURL(backPreview);
  }, [frontPreview, backPreview]);

  const choose = (side, file) => {
    const url = URL.createObjectURL(file);
    if (side === 'front') {
      setFront(file);
      setFrontPreview(url);
    } else {
      setBack(file);
      setBackPreview(url);
    }
    setResult(null);
    setForm(null);
    setError('');
  };

  async function analyze() {
    setBusy(true);
    setError('');
    try {
      const body = new FormData();
      body.append('front', front);
      body.append('back', back);
      body.append('item_type', itemType);
      const response = await fetch('/api/analyze', { method: 'POST', body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Analysis failed');
      setResult(data);
      setCondition(data.suggested_condition || 'Fine');
      setForm({
        year: data.year || 'Unknown',
        country: data.country || 'Unknown',
        denomination: data.denomination || (itemType === 'currency' ? 'Unknown note' : 'Unknown coin'),
        variety: data.variety || '',
        mint_mark: data.mint_mark || (itemType === 'currency' ? 'Not applicable' : 'None seen'),
        material: data.material || (itemType === 'currency' ? 'Paper currency' : 'Unknown'),
        serial_number: data.serial_number || '',
      });
    } catch (caught) {
      setError(caught.message || 'Could not analyze images');
    } finally {
      setBusy(false);
    }
  }

  function useCandidate(candidate) {
    const labels = {
      'Peace Silver Dollar': { denomination: '1 Dollar', material: 'Silver' },
      'Morgan Silver Dollar': { denomination: '1 Dollar', material: 'Silver' },
      'United States Silver Dollar': { denomination: '1 Dollar', material: 'Silver' },
      'Liberty Head Five-Cent Nickel (V Nickel)': { denomination: '5 Cents', material: 'Nickel alloy' },
      'Buffalo / Indian Head Nickel': { denomination: '5 Cents', material: 'Nickel alloy' },
    };
    setForm((current) => ({
      ...current,
      variety: candidate.label,
      ...(labels[candidate.label] || {}),
    }));
  }

  const marketQuery = useMemo(() => form ? buildQuery(form, itemType) : '', [form, itemType]);
  const marketLinks = useMemo(() => marketQuery ? buildLinks(marketQuery, itemType) : [], [marketQuery, itemType]);

  async function save() {
    const frontData = await fileToDataUrl(front);
    const backData = await fileToDataUrl(back);
    const estimate = result.condition_estimates?.find((item) => item.condition === condition) || result.estimate;
    const item = {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      photo_front_url: frontData,
      photo_back_url: backData,
      ...result,
      ...form,
      item_type: itemType,
      condition,
      value_low: estimate?.value_low || 0,
      value_high: estimate?.value_high || 0,
      market_query: marketQuery,
      market_links: marketLinks,
    };
    saveCoins([item, ...loadCoins()]);
    navigate('/catalog');
  }

  const reset = () => {
    setFront(null);
    setBack(null);
    setFrontPreview('');
    setBackPreview('');
    setResult(null);
    setForm(null);
    setError('');
  };

  const estimate = result?.condition_estimates?.find((item) => item.condition === condition) || result?.estimate;

  return (
    <div className="page">
      <div className="page-title">
        <Link to="/"><ArrowLeft /></Link>
        <div>
          <h1>Scan Coin or Currency</h1>
          <p>Photograph both sides in bright, even light.</p>
        </div>
      </div>

      {!result && (
        <>
          <div className="type-switch" role="group" aria-label="Item type">
            <button className={itemType === 'coin' ? 'active' : ''} onClick={() => setItemType('coin')}>
              <Coins size={20} /> Coin
            </button>
            <button className={itemType === 'currency' ? 'active' : ''} onClick={() => setItemType('currency')}>
              <Banknote size={20} /> Paper Money
            </button>
          </div>

          <div className="photo-grid">
            <PhotoCapture
              label="Front"
              file={front}
              preview={frontPreview}
              onChange={(file) => choose('front', file)}
              onClear={() => { setFront(null); setFrontPreview(''); }}
            />
            <PhotoCapture
              label="Back"
              file={back}
              preview={backPreview}
              onChange={(file) => choose('back', file)}
              onClear={() => { setBack(null); setBackPreview(''); }}
            />
          </div>

          <div className="camera-tips">
            <b>Best results:</b> clean the phone lens, use a plain dark background, avoid flash glare,
            hold the camera straight above the item, and fill most of the frame without cutting off the rim or edges.
          </div>

          <button className="primary big full" disabled={!front || !back || busy} onClick={analyze}>
            {busy ? <><Loader2 className="spin" /> Enhancing and analyzing…</> : <><Search /> Analyze both sides</>}
          </button>
        </>
      )}

      {error && (
        <div className="error">
          <AlertTriangle />
          <div><b>Analysis did not finish</b><p>{error}</p></div>
        </div>
      )}

      {result && form && (
        <section className="result-card">
          <div className="result-head">
            <div>
              <span className="eyebrow">LIKELY IDENTIFICATION</span>
              <h2>{form.year} {form.variety || form.denomination}</h2>
              <p>{form.country} · {form.denomination}</p>
            </div>
            <span className={`confidence ${result.confidence || 'low'}`}>
              {result.confidence || 'low'} confidence
            </span>
          </div>

          {result.needs_confirmation && (
            <div className="confirm-warning">
              <AlertTriangle size={20} />
              <div>
                <b>Confirm this before trusting the price.</b>
                <p>The photos did not provide enough evidence for a high-confidence identification. Correct any field below.</p>
              </div>
            </div>
          )}

          {!!result.candidates?.length && (
            <div className="candidate-box">
              <span>Possible matches</span>
              <div className="candidate-list">
                {result.candidates.slice(0, 3).map((candidate) => (
                  <button key={candidate.key} onClick={() => useCandidate(candidate)}>
                    <CheckCircle2 size={16} />
                    <span>{candidate.label}</span>
                    <small>{candidate.score} points</small>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="edit-grid">
            <label>Year<input value={form.year} onChange={(event) => setForm({ ...form, year: event.target.value })} /></label>
            <label>Country<input value={form.country} onChange={(event) => setForm({ ...form, country: event.target.value })} /></label>
            <label>Denomination<input value={form.denomination} onChange={(event) => setForm({ ...form, denomination: event.target.value })} /></label>
            <label>Type / Variety<input value={form.variety} onChange={(event) => setForm({ ...form, variety: event.target.value })} /></label>
            {itemType === 'coin' ? (
              <label>Mint mark<input value={form.mint_mark} onChange={(event) => setForm({ ...form, mint_mark: event.target.value })} /></label>
            ) : (
              <label>Serial number<input value={form.serial_number} onChange={(event) => setForm({ ...form, serial_number: event.target.value })} /></label>
            )}
            <label>Material<input value={form.material} onChange={(event) => setForm({ ...form, material: event.target.value })} /></label>
          </div>

          <div className="detail-grid">
            <div><span>Front text</span><b>{result.front_text || 'None read'}</b></div>
            <div><span>Back text</span><b>{result.back_text || 'None read'}</b></div>
            <div><span>Image quality</span><b>{result.image_quality || 'Unknown'}</b></div>
            <div><span>Search phrase</span><b>{marketQuery || 'Not ready'}</b></div>
          </div>

          <label className="condition-select">
            Condition
            <select value={condition} onChange={(event) => setCondition(event.target.value)}>
              {CONDITIONS.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>

          <div className="value-box">
            <span>Estimated market range</span>
            <strong>{money(estimate?.value_low)} – {money(estimate?.value_high)}</strong>
            <small>{result.price_note}</small>
          </div>

          <p className="explanation">{result.value_explanation}</p>

          <div className="market-links">
            {marketLinks.map((link) => (
              <a key={link.url} href={link.url} target="_blank" rel="noreferrer">
                <ExternalLink size={15} />{link.label}
              </a>
            ))}
          </div>

          <div className="action-row">
            <button className="secondary" onClick={reset}><RefreshCw /> Start over</button>
            <button className="primary" onClick={save}><Save /> Save item</button>
          </div>
        </section>
      )}
    </div>
  );
}
