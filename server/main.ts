import { createServer } from './index.ts';
const { server } = createServer();
const port = Number(process.env.PORT || 2567);
server.listen(port, () => console.log(`Vault Crew listening on ${port}`));
