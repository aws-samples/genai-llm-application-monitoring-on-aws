# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

from langchain_community.llms import Bedrock
from langchain.prompts.prompt import PromptTemplate
from traceloop.sdk.decorators import workflow, task
import boto3

# set up client for checking toxicity
comprehend = boto3.client('comprehend')

# prompt template
template = """Human: You are an expert cloud engineer with a special focus on infrastructure as code with AWS.
Your jobs is to write a cloud formation template to accomplish whatever the human asks of you and to respond to requests from the human for updates.

Provide the output CloudFormation template in YAML format which is viewable as code in markdown.
ALWAYS use the yaml formatting below when making a template for the human.
```yaml
[CloudFormation Template here]
```

If the user response is not able to be accomplished in cloud formation, say "Sorry this is not supported by AWS CloudFormation" and given an explanation of why if you know exactly why it is not supported.

Assistant:
I can absolutely help with this. What would you like me to build for you?
{chat_history}
Assistant:"""
prompt_template = PromptTemplate(
    input_variables=["user_input"], template=template
)

def format_history(chat_history):
    history = ''
    for message in chat_history:
        if message['role'] == 'assistant':
            history += f"Assistant:\n{message['content']}\n\n"
        else:
            history += f"Human:\n{message['content']}\n\n"
    return history

# generation function
@task(name="check_toxicity")
def check_toxicity(prompt):
    response = comprehend.detect_toxic_content(
        TextSegments=[
            {'Text': prompt},
        ],
        LanguageCode='en'
    )
    labels = response['ResultList'][0]['Labels']
    toxic = any(label['Score'] > 0.7 for label in labels)
    return toxic, labels

# generation function
@task(name="llm_call")
def llm_call(prompt, model_id):
    llm = Bedrock(model_id=model_id, model_kwargs={'max_tokens_to_sample':2000})
    out = llm.invoke(prompt)
    return out

# function to generate cloud formation templates
@workflow(name="generate_cfn")
def generate_cfn(chat_history, model_id):

    # format prompt
    prompt = prompt_template.format_prompt(chat_history=format_history(chat_history))
    
    # check toxicity
    toxic, labels = check_toxicity(chat_history[-1]['content'])
    if toxic:
        return "Sorry I will not respond when toxic inputs are detected."

    # generation call
    out = llm_call(prompt.text, model_id)
    return out
