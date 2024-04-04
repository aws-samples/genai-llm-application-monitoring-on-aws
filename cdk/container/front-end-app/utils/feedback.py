# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import streamlit as st
from traceloop.sdk.decorators import task


@task('cfn_user_feedback')
def trace_feedback(feedback):
    if feedback == 'helpful':
        st.session_state.user_feedback = 1
    elif feedback == 'not helpful':
        st.session_state.user_feedback = -1
    output = {
        'model_id': st.session_state.model_id,
        'messages': st.session_state.messages,
        'user_feedback': st.session_state.user_feedback,
    }
    return output
