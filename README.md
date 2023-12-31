# MOVED TO 
> https://github.com/newrelic-experimental/nr-custom-attr-data-aggregator

# Custom attribute data aggregator.

Queries New Relic data for delimited fields, gathers unique values and reingests for use in dashboard filters.

Intended to run in an synthetic monitor on a regular frequency, can also be run locally for testing.


# Send the test data to your account:

```
export NR_INGEST_KEY="...NRAL"
export NR_QUERY_KEY="NRAK-..."
export NR_ACCOUNT_ID="000000"

gzip -c test_data.json | curl -X POST -H "Content-Type: application/json" -H "Api-Key: ${NR_INGEST_KEY}" -H "Content-Encoding: gzip" "https://insights-collector.newrelic.com/v1/accounts/${NR_ACCOUNT_ID}/events" --data-binary @-

gzip -c test_data2.json | curl -X POST -H "Content-Type: application/json" -H "Api-Key: ${NR_INGEST_KEY}" -H "Content-Encoding: gzip" "https://insights-collector.newrelic.com/v1/accounts/${NR_ACCOUNT_ID}/events" --data-binary @-
```



# Run the script:
```
npm install
node generateData.sh
```


# Query the data:

```
select * from dashFilterData
```
