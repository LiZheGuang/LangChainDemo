import { render } from "ink";
import { diagnoseModel, listModelIds, modelConfig } from "../config/model.js";
import { createResearchSession } from "../session/research-session.js";
import { App } from "./app.js";

export async function runTui(): Promise<void> {
  const instance = render(
    <App
      session={createResearchSession()}
      models={listModelIds()}
      diagnose={(id) => diagnoseModel(modelConfig(id))}
    />,
  );
  await instance.waitUntilExit();
}
