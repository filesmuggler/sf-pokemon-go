import { config } from "dotenv";

// Mirror Next.js precedence: .env.local overrides .env
config({ path: [".env.local", ".env"] });
