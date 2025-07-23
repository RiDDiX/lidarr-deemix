import * as dotenv from 'dotenv';
dotenv.config();

import express from "express";
import { mergeArtists, getArtistsFromAllSources } from "./helpers";

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.get("/api/v1/search", async (req, res) => {
  const searchTerm = req.query.term as string;
  try {
    const results = await getArtistsFromAllSources(searchTerm);
    res.json(results);
  } catch (e) {
    // Wenn beide Quellen down, gib leeres Array zurück
    res.status(200).json([]);
  }
});

// ggf. andere Endpunkte...

app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});
