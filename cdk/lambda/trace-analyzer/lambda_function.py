# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import json
import boto3
from pprint import pprint
import os

# boto3 configurations to cloudformation firehose and bedrock runtime
cfn_client = boto3.client('cloudformation')
bedrock = boto3.client('bedrock-runtime', region_name='us-west-2')
fh_client = boto3.client('firehose')
fh_stream_name = os.environ['FIREHOSE_STREAM_NAME']

# evaluation template for llm self evaluation
cfn_evaluation_template ='''Human: You are an expert AWS cloud engineer who knows everything about AWS and infrastructure as code.
Your job is to evaluate the following cloud formation template which was provided to a human (H) by an assistant (H) based on the conversational context below.
Here is the original conversation right before the template was provided.

<conversation>
{conversation}
</conversation>

<cloudformation-template>
{template}
</cloudformation-template>

Answer the following questions in a markdown numbered list where each answer contains only one word "yes" or "no".
Preserve the order of the questions in your answered list.

1. Are there any glaring security issues in the template?
2. Does the template accomplish what the human was asking for?

Assistant:
Here are the answers to your questions.
'''

nullable_keys = ['valid_template', 'llm_security_issue_found', 'llm_answered_question']

def validate_cloudformation_template(template_body):
    try:
        response = cfn_client.validate_template(TemplateBody=template_body)
        return True
    except Exception as e:
        return False

def parse_llm_eval(completion):
    try:
        first_split = completion.split('1. ')[1]
        second_split = first_split.split('2. ')[1]
        first_question = first_split.split('\n')[0].strip().lower()
        second_question = second_split.split('\n')[0].strip().lower()
        first_question = 'yes' if 'yes' in first_question else 'no'
        second_question = 'yes' if 'yes' in second_question else 'no'
        return [first_question, second_question]
    except Exception as e:
        print(e)
        return '', ''

def analyze_llm(trace):
    analysis = {}
    
    # basic dialogue metrics
    analysis['dialogue_turns'] = len(trace['full_prompt'].split('Human:')) - 2

    # extraction and validation of cloud formation template
    if '```yaml' in trace['completion']:
        cfn_yaml = trace['completion'].split('```yaml')[-1].split('```')[0]

        conversation = trace['full_prompt'].replace('Human:', 'H:').replace('Assistant:', 'A:')

        # validate the template
        analysis['valid_template'] = validate_cloudformation_template(cfn_yaml)

        # advanced llm self evaluations
        eval_prompt = cfn_evaluation_template.replace('{template}', cfn_yaml).replace('{conversation}',conversation)
        body = json.dumps({
            "prompt": eval_prompt,
            "max_tokens_to_sample": 100,
            "temperature": 0.9
        })
        response = bedrock.invoke_model(
            body=body,
            modelId="anthropic.claude-instant-v1",
            accept='application/json', 
            contentType='application/json'
        )
        response_body = json.loads(response['body'].read())
        completion = response_body['completion']
        answers = parse_llm_eval(completion)
        analysis['llm_security_issue_found'] = answers[0]
        analysis['llm_answered_question'] = answers[1]

    else:
        analysis['valid_template'] = None

    return analysis

def analyze_toxicity(trace):
    return {}

def analyze_feedback(trace):
    return {}

def lambda_handler(event, context):

    print(event)

    # load the trace and ensure it is is valid
    traces = json.loads(event['body'])
    for trace in traces:
        
        # analyze important information
        if trace['task'] == 'llm_call':
            output = analyze_llm(trace)
        if 'toxicity' in trace['task']:
            output = analyze_toxicity(trace)
        elif 'feedback' in trace['task']:
            output = analyze_feedback(trace)
        trace.update(output)
        for key in nullable_keys:
            if key not in trace.keys():
                trace[key] = None

        print(trace)

        # prepare records for firehose
        fh_stream_records = []
        fh_stream_records.append({'Data': (json.dumps(trace) + "\n").encode('utf-8')})
    
    # send the trace to firehose
    fh_client.put_record_batch( DeliveryStreamName=fh_stream_name, Records=fh_stream_records)

    # return the analyzed trace
    return {
        'statusCode': 200,
        'body': 'complete'
    }
