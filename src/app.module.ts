import { Module, Type } from "@nestjs/common";
import { ChatModule } from "./chat-backend/chat.module";
import { PrismaModule } from "./infra/prisma/prisma.module";
import { CommonModule } from "./common/common.module";
import { HotPathMessagingModule } from "./common/hotpath-messaging.module";
import { getEnv } from "./config/environment";

const CORE_IMPORTS: Type[] = [
  PrismaModule,
  CommonModule,
  HotPathMessagingModule,
];
const FEATURE_REGISTRY: Record<string, readonly Type[]> = {
  chat: [ChatModule],
};

function resolveModuleImports(): Type[] {
  const env = getEnv();
  const activeModule = env.service.activeModule;
  const allowedModules = new Set(env.service.allowedModules);

  if (!allowedModules.has(activeModule)) {
    const errorPayload = {
      event: "runtime.module_boot_failure",
      code: "module.not_allowed",
      activeModule,
      allowedModules: Array.from(allowedModules),
    };
    console.error(JSON.stringify(errorPayload));
    throw new Error(
      `Refusing to boot disallowed module "${activeModule}". Allowed modules: ${Array.from(
        allowedModules,
      ).join(", ")}`,
    );
  }

  const featureModules = FEATURE_REGISTRY[activeModule];

  if (!featureModules) {
    const errorPayload = {
      event: "runtime.module_boot_failure",
      code: "module.unknown",
      activeModule,
      allowedModules: Array.from(allowedModules),
    };
    console.error(JSON.stringify(errorPayload));
    throw new Error(`Unsupported runtime module "${activeModule}"`);
  }

  const forbiddenEntries = env.service.allowedModules.filter(
    (moduleName) => FEATURE_REGISTRY[moduleName] === undefined,
  );

  if (forbiddenEntries.length > 0) {
    const errorPayload = {
      event: "runtime.module_boot_failure",
      code: "module.unsupported_allowlist",
      forbiddenEntries,
      allowedModules: env.service.allowedModules,
    };
    console.error(JSON.stringify(errorPayload));
    throw new Error(
      `ALLOWED_MODULES references unsupported modules: ${forbiddenEntries.join(", ")}`,
    );
  }

  return [...CORE_IMPORTS, ...featureModules];
}

@Module({
  imports: resolveModuleImports(),
})
export class AppModule {}
