# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import streamlit as st
from utils.generate import generate_cfn
from utils.feedback import trace_feedback
from traceloop.sdk import Traceloop
import boto3
import os
import json

# set up telemetry tracking
TRACELOOP_LOCAL_TESTING_URL="http://127.0.0.1:4318"
TRACELOOP_BASE_URL = os.getenv('TRACELOOP_BASE_URL', TRACELOOP_LOCAL_TESTING_URL)
os.environ['TRACELOOP_BASE_URL'] = TRACELOOP_BASE_URL
Traceloop.init(app_name="llm-app-2")

# add title and rest of application
st.title("Text-to-DSL Observable Application")

# subtitle
st.markdown("""
The goal of this application is to generate an AWS CloudFormation Template
which can be chatted with and changed as you go. Ask the assistant to generate something
which is useful in AWS!
"""
)

# set up session variables
if "messages" not in st.session_state:
    st.session_state.messages = []
    st.session_state.user_feedback = 0
    st.session_state.model_id = "anthropic.claude-instant-v1"

# Display chat messages from history on app rerun
for message in st.session_state.messages:
    with st.chat_message(message["role"]):
        st.markdown(message["content"])

# Accept user input
if prompt := st.chat_input("What do you want your AWS CloudFormation template to do?"):
    
    # assume user feedback to be neutral to start
    st.session_state.user_feedback = 0

    # Add user message to chat history
    st.session_state.messages.append({"role": "user", "content": prompt})

    # Display user message in chat message container
    with st.chat_message("user"):
        st.markdown(prompt)

    # Display assistant response in chat message container
    with st.chat_message("assistant"):
        response = generate_cfn(st.session_state.messages, st.session_state.model_id)
        st.markdown(response)

    # save the session state message for the next prompt
    if response == "Sorry I will not respond when toxic inputs are detected.":
        st.session_state.messages = []
        st.session_state.messages.append({"role": "assistant", "content": response})
        st.session_state.messages.append({"role": "user", "content": "----- REDACTED -----"})
    else:
        st.session_state.messages.append({"role": "assistant", "content": response})

# add the user feedback sidebar
with st.sidebar:

    # display like buttons
    st.markdown('## Your feedback is always appreciated!')
    if len(st.session_state.messages) == 0:
        st.write('Once you start generating CloudFormation Templates you will be able to provide feedback.')
    else:
        st.button('This response was helpful', on_click=trace_feedback, args=['helpful'])
        st.button('This assistant was NOT helpful', on_click=trace_feedback, args=['not helpful'])
    
    # display confirmation message
    if st.session_state.user_feedback == 1:
        st.write('Thank you for your feedback - we are glad this app is helping!')
    elif st.session_state.user_feedback == -1:
        st.write('Thank you for your feedback - we will continuously work to improve our service for you.')
