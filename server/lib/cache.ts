import NodeCache from "node-cache";

export const cache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });

export default cache;