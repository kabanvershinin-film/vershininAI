"use client";

import React, { useEffect } from "react";
import * as WorkflowBuilderPackage from "workflow-builder";
import "reactflow/dist/style.css";
import "react-toastify/dist/ReactToastify.css";

const WorkflowBuilder = WorkflowBuilderPackage.WorkflowBuilder;
export const workflowBuilderAvailable =
  WorkflowBuilderPackage.WORKFLOW_BUILDER_STUB !== true &&
  typeof WorkflowBuilder === "function";

const WorkflowUI = ({ workflowId, initialNodeSchemas, initialWorkflowData }) => {
  useEffect(() => {
    sessionStorage.setItem("fromWorkflowBuilder", "true");
  }, []);

  if (!workflowBuilderAvailable) {
    return (
      <div className="h-full w-full flex items-center justify-center px-6">
        <div className="max-w-lg w-full rounded-2xl border border-amber-400/20 bg-amber-400/10 p-6 text-center">
          <div className="text-[10px] font-black uppercase tracking-[0.3em] text-amber-300">
            Builder unavailable
          </div>
          <h2 className="mt-3 text-lg font-bold text-white">
            Workflow editor is not installed in this checkout
          </h2>
          <p className="mt-3 text-sm leading-6 text-white/70">
            This project currently includes a local stub for the `workflow-builder`
            package, so the full template editor cannot open here.
          </p>
          <p className="mt-2 text-xs text-white/50">
            You can still use the Playground tab to run the workflow.
          </p>
          {workflowId ? (
            <a
              href={`/workflow/${workflowId}/playground`}
              className="mt-5 inline-flex items-center justify-center rounded-lg bg-[#22d3ee] px-4 py-2 text-xs font-black uppercase tracking-[0.2em] text-black transition-colors hover:bg-white"
            >
              Open Playground
            </a>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-black">
      <WorkflowBuilder 
        workflowId={workflowId}
        initialNodeSchemas={initialNodeSchemas} 
        initialWorkflowData={initialWorkflowData}
        costType="dollars" 
      />
    </div>
  );
};

export default WorkflowUI;
