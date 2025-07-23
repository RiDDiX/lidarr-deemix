import express, { Request, Response } from 'express';
import { searchLidarr } from './lidarr';
import { searchDeemix } from './deemix';
import { deduplicateArtists } from './helpers';

const app = express();

app.get(
  '/api/v1/search',
  async (req: Request, res: Response): Promise<void> => {
  const term = String(req.query.term || '');
  let lidarr: any[] = [];
  let deezer: any[] = [];

  // Parallel requests with failover
  await Promise.all([
    (async () => {
      try {
        lidarr = await searchLidarr(term);
      } catch {
        lidarr = [];
      }
    })(),
    (async () => {
      try {
        deezer = await searchDeemix(term);
      } catch {
        deezer = [];
      }
    })(),
  ]);

  const merged = deduplicateArtists(lidarr, deezer);
  res.json({ results: merged });
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => console.log(`API läuft auf Port ${PORT}`));