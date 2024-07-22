const assert = require("assert");
import {
  BaseProviderConfig,
  Connection,
  SyncHandlerStatus,
  SyncSchemaPosition,
  SyncSchemaPositionType,
} from "../../../src/interfaces";
import Providers from "../../../src/providers";
import CommonUtils, { NetworkInstance } from "../../common.utils";

import Gmail from "../../../src/providers/google/gmail";
import BaseProvider from "../../../src/providers/BaseProvider";
import { CommonTests, GenericTestConfig } from "../../common.tests";
import { SchemaEmail } from "../../../src/schemas";

const providerName = "google";
let network: NetworkInstance;
let connection: Connection;
let provider: BaseProvider;

describe(`${providerName} Tests`, function () {
  this.timeout(100000);

  this.beforeAll(async function () {
    network = await CommonUtils.getNetwork();
    connection = await CommonUtils.getConnection(providerName);
    provider = Providers(providerName, network.context, connection);
  });

  describe(`Fetch ${providerName} data`, () => {
    const handlerName = "gmail";
    const testConfig: GenericTestConfig = {
      idPrefix: "gmail",
      timeOrderAttribute: "sentAt",
      batchSizeLimitAttribute: "batchSize",
    };
    const providerConfig: Omit<BaseProviderConfig, "sbtImage" | "label"> = {};

    it(`Can pass basic tests: ${handlerName}`, async () => {
      await CommonTests.runGenericTests(
        providerName,
        Gmail,
        testConfig,
        providerConfig
      );
    });

    it(`Can limit results by timestamp`, async () => {
      const lastRecordHours = 2;
      const lastRecordTimestamp = new Date(
        Date.now() - lastRecordHours * 3600000
      ).toISOString();

      const syncPosition: Omit<SyncSchemaPosition, "_id" | "schemaUri"> = {
        type: SyncSchemaPositionType.SYNC,
        provider: providerName,
        status: SyncHandlerStatus.ACTIVE,
      };

      providerConfig.batchSize = 10;
      providerConfig.metadata = {
        breakTimestamp: lastRecordTimestamp,
      }

      const syncResponse = await CommonTests.runSyncTest(
        providerName,
        Gmail,
        testConfig,
        syncPosition,
        providerConfig
      );
      assert.ok(
        syncResponse.results && syncResponse.results.length,
        "Have results (Emails may not have been received in the testing timeframe)"
      );

      const results = <SchemaEmail[]>syncResponse.results;
      assert.ok(
        results[results.length - 1].sentAt > lastRecordTimestamp,
        "Last result is within expected date/time range"
      );
      assert.ok(
        results.length < providerConfig.batchSize,
        `Results reached the expected timestamp within the current batch size (try increating the test batch size or reducing the break timetamp)`
      );
    });
  });

  this.afterAll(async function () {
    const { context } = await CommonUtils.getNetwork();
    await context.close();
  });
});
