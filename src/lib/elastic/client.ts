import { Client, type ClientOptions } from "@elastic/elasticsearch";
import { getEnv } from "@/lib/env";

let client: Client | null = null;

export function getElasticClient(): Client {
  if (client) return client;

  const env = getEnv();
  const options: ClientOptions = { node: env.ELASTICSEARCH_URL };

  if (env.ELASTICSEARCH_API_KEY) {
    options.auth = { apiKey: env.ELASTICSEARCH_API_KEY };
  } else if (env.ELASTICSEARCH_USERNAME && env.ELASTICSEARCH_PASSWORD) {
    options.auth = {
      username: env.ELASTICSEARCH_USERNAME,
      password: env.ELASTICSEARCH_PASSWORD,
    };
  }

  client = new Client(options);
  return client;
}

export function getIndexName(): string {
  return getEnv().ELASTICSEARCH_INDEX;
}
