# RedEye Coin Scanner

A standalone front-and-back coin scanner. One Node/Express service hosts the React website and privately calls Google Cloud Vision.

## What it does
- Captures or uploads front and back photos
- Automatically rotates, resizes, normalizes, and sharpens images
- Uses Google Vision OCR, labels, web detection, and image properties
- Extracts likely country, denomination, year, mint mark, variety, and material
- Produces condition-based estimated value ranges
- Adds current comparison links for eBay sold items, PCGS CoinFacts, and Numista
- Saves the collection in the device browser

## Run locally
1. Install Node.js 20+
2. Copy `.env.example` to `.env`
3. Put your replacement Google Vision key in `.env`
4. Run:
   npm install
   npm run dev
5. Open http://localhost:5173

## Deploy to Render (one service)
1. Push this folder to GitHub
2. In Render choose **New > Blueprint** and select the repository, or create a Web Service
3. Build command: `npm install && npm run build`
4. Start command: `npm start`
5. Add secret environment variable `GOOGLE_VISION_API_KEY`
6. Deploy

## Important valuation note
The displayed value is an estimate, not an appraisal. Rare varieties, errors, authenticity, cleaning, and professional grade can change value dramatically. Use the included sold-listing and specialist links before buying or selling.
