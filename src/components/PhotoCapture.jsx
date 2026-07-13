import { Camera, ImagePlus, X } from 'lucide-react';
export default function PhotoCapture({label,file,preview,onChange,onClear}){
  return <div className="photo-box">
    <div className="photo-label">{label}</div>
    {preview ? <div className="preview-wrap"><img src={preview} alt={label}/><button type="button" onClick={onClear} aria-label={`Remove ${label}`}><X size={18}/></button></div>:
    <label className="photo-picker"><Camera size={32}/><strong>Take photo</strong><span>or choose one</span><input type="file" accept="image/*" capture="environment" onChange={e=>e.target.files?.[0]&&onChange(e.target.files[0])}/></label>}
    {file && <small>{Math.round(file.size/1024)} KB</small>}
  </div>
}
