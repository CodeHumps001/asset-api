import app from './app';
import { config } from './config';

app.listen(config.port, () => console.log(`ICT Asset API running on http://localhost:${config.port}/api`));
