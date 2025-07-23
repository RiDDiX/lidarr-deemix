import * as dotenv from 'dotenv';
dotenv.config();

import fastify from 'fastify';
import { handleLidarrRequest } from './lidarr';
import { handleDeemixRequest } from './deemix';

const app = fastify();

app.get('/api/lidarr/:artist', handleLidarrRequest);
app.get('/api/deemix/:track', handleDeemixRequest);

const PORT = process.env.PORT || 8080;
app.listen({ port: Number(PORT), host: '0.0.0.0' }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  console.log(`Server running at ${address}`);
});
