# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import json
import boto3
from pprint import pprint
import os
from urllib.parse import unquote

def format_history(chat_history):
    history = ''
    for message in chat_history:
        if message['role'] == 'assistant':
            history += f"Assistant:\n{message['content']}\n\n"
        else:
            history += f"Human:\n{message['content']}\n\n"
    return history

def extract_info_from_trace(trace):

    # start key values
    app = trace['resource']['attributes'][0]['value']['stringValue']
    records = []
    nullable_keys = [
        'user_input', 'toxicity_detected', # toxicity
        'full_prompt', 'model', 'completion', # llm generation task
        'feedback', 'model', 'conversation', # user feedback
    ]

    # drill down to the traceloop task values only
    for scope in trace['scopeSpans']:
        if scope['scope']['name'] == 'traceloop.tracer':
            for span in scope['spans']:
                if 'task' in span['name']:
                    event_data = {}

                    # pull out base data and store it
                    start_time = span['startTimeUnixNano']
                    end_time = span['endTimeUnixNano']
                    trace_id = span['traceId']

                    event_data['start_time'] = start_time
                    event_data['end_time'] = end_time
                    event_data['trace_id'] = trace_id

                    # always get some general information from each task
                    for att in span['attributes']:
                        if att['key'] == 'traceloop.workflow.name':
                            event_data['workflow'] = att['value']['stringValue']
                        if att['key'] == 'traceloop.entity.name':
                            event_data['task'] = att['value']['stringValue']

                    
                    
                    # now go back for specific information to each type of task
                    for att in span['attributes']:

                        # user feedback specific values
                        if 'feedback' in event_data['task']:
                            
                            if att['key'] == 'traceloop.entity.input':
                                event_data['feedback'] = json.loads(att['value']['stringValue'])['args'][0]
                            
                            if att['key'] == 'traceloop.entity.output':
                                event_data['model'] = json.loads(att['value']['stringValue'])['model_id']
                                event_data['conversation'] = format_history(json.loads(att['value']['stringValue'])['messages'])

                        # specific toxicity measures
                        elif 'toxicity' in event_data['task']:
                            if att['key'] == 'traceloop.entity.input':
                                event_data['user_input'] = json.loads(att['value']['stringValue'])['args'][0]
                            if att['key'] == 'traceloop.entity.output':
                                event_data['toxicity_detected'] = json.loads(att['value']['stringValue'])[0]

                        # generation outputs
                        elif 'llm_call' in event_data['task']:
                            if att['key'] == 'traceloop.entity.input':
                                event_data['full_prompt'] = json.loads(att['value']['stringValue'])['args'][0]
                                event_data['model'] = json.loads(att['value']['stringValue'])['args'][1]
                            if att['key'] == 'traceloop.entity.output':
                                event_data['completion'] = json.loads(att['value']['stringValue'])
                    
                    # ensure you have all the keys in the json file
                    for key in nullable_keys:
                        if key not in event_data.keys():
                            event_data[key] = None

                    # store the information which was extracted
                    records.append(event_data)
    return records

def lambda_handler(event, context):

    print(event)

    # Get the S3 bucket and key from the event
    bucket = event['Records'][0]['s3']['bucket']['name']
    key = unquote(event['Records'][0]['s3']['object']['key'])
    print(bucket, key)

    # Download the JSON file from S3
    s3_client = boto3.client('s3')
    response = s3_client.get_object(Bucket=bucket, Key=key)
    json_content = response['Body'].read().decode('utf-8')

    # Process the JSON data
    data = json.loads(json_content)['resourceSpans'][0]

    # perform extraction
    output = extract_info_from_trace(data)

    return {
        'statusCode': 200,
        'body': json.dumps(output)
    }
