# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

FROM python:3.11
RUN groupadd -r appgroup && useradd --no-log-init -r -g appgroup appgroup
USER appgroup:appuser
EXPOSE 8501
WORKDIR /app
COPY requirements.txt ./requirements.txt
RUN  pip3 install --upgrade pip && pip3 install -r requirements.txt
COPY . .

CMD streamlit run app.py
