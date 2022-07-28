#!/usr/bin/env node
import { App, Aws } from "aws-cdk-lib";
import { SportsDataStack } from "../lib/sports-data-stack";

// const { ACCOUNT_ID, PARTITION, REGION, STACK_NAME } = Aws;

const app = new App();
new SportsDataStack(app, "SportsDataStack");
