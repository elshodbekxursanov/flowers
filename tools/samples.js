// Sample bouquets for the demo files. Photos live in tools/sample-photos (see CREDITS.md).
// If a photo file is missing, the drawn placeholder is used instead.
const fs = require('fs');
const path = require('path');

module.exports = function samples(placeholder, tierOf) {
  const dir = path.join(__dirname, 'sample-photos');
  const img = (file, n) => {
    try { return 'data:image/jpeg;base64,' + fs.readFileSync(path.join(dir, file)).toString('base64'); }
    catch (e) { return placeholder(n); }
  };
  const S = (n, file, name, price, stock, tags, fl) => ({
    id: 1000 + n, name, price, tier: tierOf(price), tags, flowers: fl,
    recipe: Object.fromEntries(fl.map(f => [f, 1])), stock, image: img(file, n)
  });
  return [
    S(1, 'soft-bloom.jpg', 'Soft Bloom', 720000, 6, ['bestseller', 'bush', 'mix'], ['bush_roses', 'roses']),
    S(2, 'mini-dawn.jpg', 'Mini Dawn', 395000, 2, ['mini'], ['tulips']),
    S(3, 'rose-whisper.jpg', 'Rose Whisper', 805000, 4, ['bestseller', 'peony'], ['peonies']),
    S(4, 'sunset-roses.jpg', 'Sunset Roses', 1390000, 3, ['bestseller', 'roses', 'mix'], ['roses', 'greens']),
    S(5, 'rose-51.jpg', 'Rose 51', 1855000, 1, ['bestseller', 'roses'], ['roses', 'wrap']),
    S(6, 'peony-day.jpg', 'Peony Day', 1650000, 5, ['peony', 'seasonal'], ['peonies', 'greens']),
    S(7, 'white-tulips.jpg', 'White Tulips', 2094000, 2, ['bestseller', 'vip', 'seasonal'], ['tulips']),
    S(8, 'bride-dream.jpg', 'Bride Dream', 3150000, 3, ['wedding'], ['white_roses', 'greens']),
    S(9, 'tulip-mix.jpg', 'Tulip Mix', 3600000, 0, ['basket', 'vip', 'seasonal'], ['tulips']),
    S(10, 'gerbera-joy.jpg', 'Gerbera Joy', 2400000, 2, ['vip', 'mix'], ['gerbera'])
  ];
};
