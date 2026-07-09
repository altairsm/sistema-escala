class ChatwootConfiguracaoController < ApplicationController
  before_action :set_config

  def show
  end

  def edit
  end

  def update
    if @config.update(config_params)
      redirect_to chatwoot_configuracao_path, notice: "Configuração Chatwoot atualizada com sucesso."
    else
      render :edit, status: :unprocessable_content
    end
  end

  private

  def set_config
    @config = ChatwootConfiguracao.first_or_initialize
  end

  def config_params
    params.expect(chatwoot_configuracao: [ :api_url, :account_id, :inbox_id, :api_key, :n8n_webhook_url ])
  end
end
